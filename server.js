const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Helper functions for reading/writing DB
function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { users: [], sessions: [], appointments: [], logs: [], routines: [], foodScans: [], workoutHistory: [] };
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(data);
    return {
      users: parsed.users || [],
      sessions: parsed.sessions || [],
      appointments: parsed.appointments || [],
      logs: parsed.logs || [],
      routines: parsed.routines || [],
      foodScans: parsed.foodScans || [],
      workoutHistory: parsed.workoutHistory || []
    };
  } catch (error) {
    console.error('Error reading database:', error);
    return { users: [], sessions: [], appointments: [], logs: [], routines: [], foodScans: [], workoutHistory: [] };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing to database:', error);
    return false;
  }
}

// Automatically seed a default demo user and default doctor on server startup
function seedDemoUser() {
  const db = readDb();
  let modified = false;

  if (db.users.length === 0) {
    console.log('Seeding default demo user "demo" with password "demo123"...');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('demo123', salt);
    
    const demoUserId = 'demo-user-id';
    
    db.users.push({
      id: demoUserId,
      username: 'demo',
      passwordHash,
      role: 'user'
    });
    
    // Seed initial dashboard logs for the demo user
    db.logs = [
      {"userId": demoUserId, "date": "2026-05-27", "weight": 79.2, "bodyFat": 21.9, "calories": 1820, "workoutDone": true},
      {"userId": demoUserId, "date": "2026-05-28", "weight": 79.0, "bodyFat": 21.8, "calories": 1950, "workoutDone": true},
      {"userId": demoUserId, "date": "2026-05-29", "weight": 78.7, "bodyFat": 21.5, "calories": 1780, "workoutDone": true},
      {"userId": demoUserId, "date": "2026-05-30", "weight": 78.5, "bodyFat": 21.4, "calories": 2100, "workoutDone": false},
      {"userId": demoUserId, "date": "2026-05-31", "weight": 78.4, "bodyFat": 21.2, "calories": 1860, "workoutDone": true},
      {"userId": demoUserId, "date": "2026-06-01", "weight": 78.3, "bodyFat": 21.1, "calories": 2240, "workoutDone": true},
      {"userId": demoUserId, "date": "2026-06-02", "weight": 78.2, "bodyFat": 21.0, "calories": 1710, "workoutDone": true}
    ];

    // Seed initial bookings for the demo user
    db.appointments.push({
      id: "1",
      userId: demoUserId,
      therapistName: "Dr. Ankita Chowdhury",
      date: "2026-06-02",
      time: "10:30 AM"
    });

    modified = true;
  }

  // Seed doctor if not present
  const hasDoctor = db.users.some(u => u.role === 'doctor');
  if (!hasDoctor) {
    console.log('Seeding default doctor "doctor" with password "doctor123"...');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('doctor123', salt);
    const docUserId = 'demo-doctor-id';

    db.users.push({
      id: docUserId,
      username: 'doctor',
      passwordHash,
      role: 'doctor',
      name: 'Dr. Ankita Chowdhury',
      specialization: 'Sports Physio · Injury Rehab',
      rating: 4.9
    });

    db.slots = db.slots || [];
    db.slots.push(
      {
        id: 'slot-seed-1',
        doctorId: docUserId,
        doctorName: 'Dr. Ankita Chowdhury',
        specialization: 'Sports Physio · Injury Rehab',
        rating: 4.9,
        date: 'Today',
        time: '10:30 AM',
        booked: false,
        bookedBy: null
      },
      {
        id: 'slot-seed-2',
        doctorId: docUserId,
        doctorName: 'Dr. Ankita Chowdhury',
        specialization: 'Sports Physio · Injury Rehab',
        rating: 4.9,
        date: 'Tomorrow',
        time: '2:00 PM',
        booked: false,
        bookedBy: null
      }
    );

    modified = true;
  }

  if (modified) {
    writeDb(db);
  }
}

seedDemoUser();

// Convert buffer to generative part for Gemini API
function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType
    }
  };
}

// Check if Gemini API key is valid / exists
function hasValidApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return key && key.trim() !== '' && key !== 'your_key_here';
}

// Init Gemini client
let genAI;
if (hasValidApiKey()) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Fallback Gemini API content generator
async function generateContentWithFallback(prompt, imagePart = null) {
  if (!genAI) {
    throw new Error('Gemini API client is not initialized (missing API key)');
  }
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastErr = null;
  for (const modelName of models) {
    try {
      console.log(`Calling Gemini model: ${modelName}...`);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      
      const contents = imagePart ? [prompt, imagePart] : [prompt];
      const result = await model.generateContent(contents);
      const text = result.response.text();
      
      // Clean up markdown block format if present
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.substring(7);
      }
      if (cleanedText.endsWith('```')) {
        cleanedText = cleanedText.substring(0, cleanedText.length - 3);
      }
      cleanedText = cleanedText.trim();
      
      // Verify it is valid JSON
      JSON.parse(cleanedText);
      
      return { text: cleanedText, modelUsed: modelName };
    } catch (err) {
      console.warn(`Gemini API Warning (Model ${modelName} failed):`, err.message || err);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Gemini models in fallback chain failed');
}

// --- AUTHENTICATION MIDDLEWARE ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  const db = readDb();
  const session = db.sessions.find(s => s.token === token);

  if (!session) {
    return res.status(403).json({ error: 'Session expired or invalid token. Please log in again.' });
  }

  // Session expiry check (optional: sessions expire in 7 days)
  if (session.expiresAt && Date.now() > session.expiresAt) {
    // Remove expired session
    db.sessions = db.sessions.filter(s => s.token !== token);
    writeDb(db);
    return res.status(403).json({ error: 'Session expired. Please log in again.' });
  }

  // Attach user identity to request object
  req.userId = session.userId;
  next();
}

// --- API ENDPOINTS ---

// GET health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    hasApiKey: hasValidApiKey(),
    port: PORT
  });
});

// 0. AUTH ROUTING
app.post('/api/auth/register', (req, res) => {
  const { username, password, role, name, specialization, passcode } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = readDb();
  const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (existingUser) {
    return res.status(400).json({ error: 'Username is already taken' });
  }

  // Role authentication check
  let finalRole = 'user';
  if (role === 'doctor') {
    if (passcode !== 'PHYSIO-2026') {
      return res.status(400).json({ error: 'Invalid Doctor Access Passcode. You are not authorized to register as a doctor.' });
    }
    finalRole = 'doctor';
  }

  // Hash password
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const userId = Date.now().toString();

  const newUser = {
    id: userId,
    username,
    passwordHash,
    role: finalRole,
    name: finalRole === 'doctor' ? (name || `Dr. ${username}`) : name,
    specialization: finalRole === 'doctor' ? (specialization || 'General Physiotherapist') : undefined,
    rating: finalRole === 'doctor' ? 5.0 : undefined
  };
  db.users.push(newUser);

  // Auto-generate session token so they log in immediately
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days expiry

  db.sessions.push({ token, userId, expiresAt });
  writeDb(db);

  res.status(201).json({
    token,
    username,
    role: finalRole,
    name: newUser.name,
    specialization: newUser.specialization
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Create session
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days expiry

  db.sessions.push({ token, userId: user.id, expiresAt });
  writeDb(db);

  res.json({
    token,
    username,
    role: user.role || 'user',
    name: user.name,
    specialization: user.specialization
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const db = readDb();
    db.sessions = db.sessions.filter(s => s.token !== token);
    writeDb(db);
  }

  res.json({ message: 'Logged out successfully' });
});

// 1. ROUTINE ENDPOINTS (USER ISOLATED)
app.get('/api/routine', authenticateToken, (req, res) => {
  const db = readDb();
  const userRoutine = db.routines.find(r => r.userId === req.userId);
  if (!userRoutine) {
    return res.status(404).json({ error: 'No generated routine found for this user.' });
  }
  res.json(userRoutine);
});

app.post('/api/routine', authenticateToken, async (req, res) => {
  const { goal, days, level, equipment } = req.body;
  if (!goal || !days || !level || !equipment) {
    return res.status(400).json({ error: 'Goal, days, level, and equipment are required' });
  }

  const prompt = `
Generate a weekly fitness workout routine in JSON format.
Parameters:
- Goal: ${goal}
- Days per week: ${days}
- Experience level: ${level}
- Equipment available: ${equipment}

You must return a JSON object with EXACTLY the following structure (do not include any additional keys, markdown text, or surrounding explanation):
{
  "title": "A descriptive title for this routine",
  "overview": "A brief 2-3 sentence summary of the program's methodology and focus",
  "routine": [
    {
      "day": "Day name (Mon, Tue, Wed, Thu, Fri, Sat, or Sun)",
      "name": "Focus of the day (e.g., Upper Body Power, Lower Body Strength, HIIT Cardio, or Rest & Recovery)",
      "exercises": [
        {
          "name": "Exercise Name",
          "sets": 3,
          "reps": "10-12 reps",
          "rest": "60s",
          "coachingCue": "A brief form/safety tip (e.g., Keep chest up, lock core)"
        }
      ]
    }
  ]
}

Ensure there are exactly 7 elements in the "routine" array, corresponding to Mon, Tue, Wed, Thu, Fri, Sat, and Sun in order.
For days that exceed the workout days parameter (which is ${days} days per week), mark them as rest days with "Rest & Recovery" or similar name, and set exercises to a single stretching/mobility item (e.g., name: "Active Recovery Stretching", sets: 1, reps: "15 min", rest: "N/A", coachingCue: "Deep breathing").
Return ONLY valid JSON.
`;

  try {
    const result = await generateContentWithFallback(prompt);
    const data = JSON.parse(result.text);

    const db = readDb();
    db.routines = db.routines.filter(r => r.userId !== req.userId);

    const savedRoutine = {
      userId: req.userId,
      title: data.title,
      overview: data.overview,
      routine: data.routine,
      isMock: false,
      modelUsed: result.modelUsed
    };

    db.routines.push(savedRoutine);
    writeDb(db);

    return res.json(savedRoutine);
  } catch (err) {
    console.error("Gemini Routine generation failed, falling back to mock:", err.message || err);
    
    const mockRoutine = generateMockRoutine(goal, days, level, equipment);
    const db = readDb();
    db.routines = db.routines.filter(r => r.userId !== req.userId);

    const savedRoutine = {
      userId: req.userId,
      ...mockRoutine,
      isMock: true,
      errorMsg: err.message
    };

    db.routines.push(savedRoutine);
    writeDb(db);

    return res.json(savedRoutine);
  }
});

// 2. FOOD PHOTO SCANNER ENDPOINT (USER ISOLATED)
app.post('/api/scan-food', authenticateToken, upload.single('image'), async (req, res) => {
  const prompt = `
Analyze this meal image and return details in JSON format.
Estimate the name of the dish, portion size/serving weight, calories, macro breakdown (Protein, Carbs, Fat in grams), list of detected ingredients, and helpful nutrition advice.

You must return a JSON object with EXACTLY the following structure (do not include any additional keys or surrounding explanation):
{
  "dish": "Name of the dish (e.g., Chicken Avocado Salad)",
  "calories": 420,
  "servingSize": "A description of the portion size (e.g., 1 plate (~350g))",
  "protein": 34,
  "carbs": 12,
  "fat": 26,
  "ingredients": ["list", "of", "ingredients", "detected"],
  "advice": "1-2 sentences of nutrition advice based on the user's fitness context"
}

Return ONLY valid JSON.
`;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);
    const result = await generateContentWithFallback(prompt, imagePart);
    const data = JSON.parse(result.text);

    const responseData = {
      ...data,
      isMock: false,
      modelUsed: result.modelUsed
    };

    // Save to user scans history
    const db = readDb();
    db.foodScans = db.foodScans || [];
    db.foodScans.push({
      id: Date.now().toString(),
      userId: req.userId,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      dish: responseData.dish,
      calories: responseData.calories,
      protein: responseData.protein,
      carbs: responseData.carbs,
      fat: responseData.fat,
      ingredients: responseData.ingredients,
      advice: responseData.advice,
      isMock: false
    });
    writeDb(db);

    return res.json(responseData);
  } catch (err) {
    console.error("Gemini Food Scanner failed, falling back to mock:", err.message || err);
    
    const mockFood = generateMockFoodScan();
    const responseData = {
      ...mockFood,
      isMock: true,
      errorMsg: err.message
    };

    // Save to user scans history
    const db = readDb();
    db.foodScans = db.foodScans || [];
    db.foodScans.push({
      id: Date.now().toString(),
      userId: req.userId,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      dish: responseData.dish,
      calories: responseData.calories,
      protein: responseData.protein,
      carbs: responseData.carbs,
      fat: responseData.fat,
      ingredients: responseData.ingredients,
      advice: responseData.advice,
      isMock: true
    });
    writeDb(db);

    return res.json(responseData);
  }
});

// 2.5 USER PERSISTENT HISTORY ROUTING (USER ISOLATED)
app.get('/api/food-scans', authenticateToken, (req, res) => {
  const db = readDb();
  const scans = db.foodScans || [];
  const userScans = scans.filter(s => s.userId === req.userId);
  userScans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(userScans);
});

app.get('/api/workout-history', authenticateToken, (req, res) => {
  const db = readDb();
  const history = db.workoutHistory || [];
  const userHistory = history.filter(w => w.userId === req.userId);
  userHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(userHistory);
});

app.post('/api/workout-history', authenticateToken, (req, res) => {
  const { workoutName, exercisesCount, date } = req.body;
  if (!workoutName) {
    return res.status(400).json({ error: 'Workout name is required' });
  }

  const db = readDb();
  db.workoutHistory = db.workoutHistory || [];
  
  const historyEntry = {
    id: Date.now().toString(),
    userId: req.userId,
    date: date || new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    workoutName,
    exercisesCount: exercisesCount || 0
  };

  db.workoutHistory.push(historyEntry);
  writeDb(db);

  res.status(201).json(historyEntry);
});

// 3. PHYSIO CLINIC BOOKING & APPOINTMENTS (USER & DOCTOR INTERACTIVE)

// Get patient's appointments
app.get('/api/physio/appointments', authenticateToken, (req, res) => {
  const db = readDb();
  const userAppointments = db.appointments.filter(app => app.userId === req.userId);
  res.json(userAppointments);
});

// Book a session (Patient only)
app.post('/api/physio/book', authenticateToken, (req, res) => {
  const { slotId, therapistName, date, time } = req.body;
  const db = readDb();

  if (slotId) {
    // Find the slot
    db.slots = db.slots || [];
    const slotIndex = db.slots.findIndex(s => s.id === slotId);
    if (slotIndex === -1) {
      return res.status(404).json({ error: 'Selected time slot was not found or is no longer available.' });
    }
    if (db.slots[slotIndex].booked) {
      return res.status(400).json({ error: 'This slot has already been booked.' });
    }

    // Mark the slot as booked
    db.slots[slotIndex].booked = true;
    db.slots[slotIndex].bookedBy = req.userId;

    const slot = db.slots[slotIndex];
    
    // Fetch patient name
    const patientUser = db.users.find(u => u.id === req.userId);
    const patientName = patientUser ? patientUser.username : 'Patient';

    const newAppointment = {
      id: Date.now().toString(),
      slotId: slot.id,
      userId: req.userId,
      patientName,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      therapistName: slot.doctorName,
      date: slot.date,
      time: slot.time,
      status: 'pending'
    };

    db.appointments.push(newAppointment);
    writeDb(db);
    return res.status(201).json(newAppointment);
  } else {
    // Fallback custom slot
    if (!therapistName || !date || !time) {
      return res.status(400).json({ error: 'Missing appointment details (therapistName, date, time)' });
    }

    const doctorUser = db.users.find(u => u.role === 'doctor' && u.name.toLowerCase() === therapistName.toLowerCase());

    const newAppointment = {
      id: Date.now().toString(),
      userId: req.userId,
      patientName: db.users.find(u => u.id === req.userId)?.username || 'Patient',
      doctorId: doctorUser ? doctorUser.id : null,
      doctorName: therapistName,
      therapistName,
      date,
      time,
      status: 'pending'
    };

    db.appointments.push(newAppointment);
    writeDb(db);
    return res.status(201).json(newAppointment);
  }
});

// Cancel a booking (Patient or Doctor)
app.post('/api/physio/cancel', authenticateToken, (req, res) => {
  const { appointmentId } = req.body;
  if (!appointmentId) {
    return res.status(400).json({ error: 'Appointment ID is required' });
  }

  const db = readDb();
  const appIndex = db.appointments.findIndex(app => app.id === appointmentId);
  
  if (appIndex === -1) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const appointment = db.appointments[appIndex];
  
  // Verify authorization: caller must be the patient or the doctor
  if (appointment.userId !== req.userId && appointment.doctorId !== req.userId) {
    return res.status(403).json({ error: 'Not authorized to cancel this appointment' });
  }

  // Free up slot if applicable
  if (appointment.slotId) {
    const slotIndex = (db.slots || []).findIndex(s => s.id === appointment.slotId);
    if (slotIndex !== -1) {
      db.slots[slotIndex].booked = false;
      db.slots[slotIndex].bookedBy = null;
    }
  }

  db.appointments.splice(appIndex, 1);
  writeDb(db);

  res.json({ message: 'Appointment cancelled successfully' });
});

// Available slots for patients
app.get('/api/physio/available-slots', (req, res) => {
  const db = readDb();
  const slots = db.slots || [];
  const available = slots.filter(s => !s.booked);
  res.json(available);
});

// Doctor specific routes

// Add slot (Doctor only)
app.post('/api/physio/slots', authenticateToken, (req, res) => {
  const db = readDb();
  const currentUser = db.users.find(u => u.id === req.userId);
  if (!currentUser || currentUser.role !== 'doctor') {
    return res.status(403).json({ error: 'Access denied: Only physiotherapists can manage slots.' });
  }

  const { date, time } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required' });
  }

  db.slots = db.slots || [];
  const newSlot = {
    id: Date.now().toString(),
    doctorId: req.userId,
    doctorName: currentUser.name || currentUser.username,
    specialization: currentUser.specialization || 'General Physiotherapist',
    rating: currentUser.rating || 5.0,
    date,
    time,
    booked: false,
    bookedBy: null
  };

  db.slots.push(newSlot);
  writeDb(db);

  res.status(201).json(newSlot);
});

// Get Doctor slots (Doctor only)
app.get('/api/physio/doctor-slots', authenticateToken, (req, res) => {
  const db = readDb();
  const slots = db.slots || [];
  const doctorSlots = slots.filter(s => s.doctorId === req.userId);
  res.json(doctorSlots);
});

// Delete slot (Doctor only)
app.delete('/api/physio/slots/:id', authenticateToken, (req, res) => {
  const db = readDb();
  db.slots = db.slots || [];
  const slotIndex = db.slots.findIndex(s => s.id === req.params.id && s.doctorId === req.userId);
  
  if (slotIndex === -1) {
    return res.status(404).json({ error: 'Slot not found or not authorized.' });
  }

  const slot = db.slots[slotIndex];
  if (slot.booked) {
    db.appointments = (db.appointments || []).filter(app => app.slotId !== slot.id);
  }

  db.slots.splice(slotIndex, 1);
  writeDb(db);

  res.json({ message: 'Slot deleted successfully' });
});

// Get doctor bookings (Doctor only)
app.get('/api/physio/doctor-bookings', authenticateToken, (req, res) => {
  const db = readDb();
  const appointments = db.appointments || [];
  const docBookings = appointments.filter(app => app.doctorId === req.userId);
  res.json(docBookings);
});

// Complete/Accept session (Doctor only)
app.post('/api/physio/doctor-bookings/complete', authenticateToken, (req, res) => {
  const { appointmentId, status } = req.body;
  if (!appointmentId || !status) {
    return res.status(400).json({ error: 'Appointment ID and status are required' });
  }

  const db = readDb();
  const appIndex = db.appointments.findIndex(app => app.id === appointmentId && app.doctorId === req.userId);
  
  if (appIndex === -1) {
    return res.status(404).json({ error: 'Appointment not found or not authorized' });
  }

  db.appointments[appIndex].status = status;
  writeDb(db);

  res.json(db.appointments[appIndex]);
});

// 4. ANALYTICS & LOGGING (USER ISOLATED)
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const db = readDb();
  const allLogs = db.logs || [];
  
  // Filter logs for this specific user
  const logs = allLogs.filter(log => log.userId === req.userId);

  if (logs.length === 0) {
    return res.json({
      totalFatLost: 0,
      avgDailyCalories: 0,
      workoutsCompleted: 0,
      totalWorkouts: 0,
      streak: 0,
      logs: []
    });
  }

  // Sort logs by date ascending
  logs.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Compute total weight/fat lost
  let totalFatLost = 0;
  if (logs.length > 1) {
    const firstWeight = logs[0].weight;
    const lastWeight = logs[logs.length - 1].weight;
    totalFatLost = Math.max(0, (firstWeight - lastWeight)).toFixed(1);
  }

  // Compute avg daily calories (last 7 logs)
  const last7Logs = logs.slice(-7);
  const totalCalories = last7Logs.reduce((sum, log) => sum + (log.calories || 0), 0);
  const avgDailyCalories = Math.round(totalCalories / last7Logs.length);

  // Compute workouts completed
  const workoutsCompleted = logs.filter(log => log.workoutDone).length;
  const totalWorkouts = logs.length;

  // Compute current streak (consecutive days of workoutDone = true from latest date backwards)
  let streak = 0;
  const reversedLogs = [...logs].reverse();
  for (const log of reversedLogs) {
    if (log.workoutDone) {
      streak++;
    } else {
      break;
    }
  }

  res.json({
    totalFatLost: parseFloat(totalFatLost),
    avgDailyCalories,
    workoutsCompleted,
    totalWorkouts,
    streak,
    logs
  });
});

app.post('/api/dashboard/log', authenticateToken, (req, res) => {
  const { date, weight, bodyFat, calories, workoutDone } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });
  }

  const db = readDb();
  const allLogs = db.logs || [];

  // Check if log already exists for this date and user
  const existingLogIndex = allLogs.findIndex(log => log.date === date && log.userId === req.userId);

  const logEntry = {
    userId: req.userId,
    date,
    weight: weight !== undefined ? parseFloat(weight) : undefined,
    bodyFat: bodyFat !== undefined ? parseFloat(bodyFat) : undefined,
    calories: calories !== undefined ? parseInt(calories) : undefined,
    workoutDone: workoutDone !== undefined ? !!workoutDone : false
  };

  if (existingLogIndex !== -1) {
    // Merge updates
    const current = allLogs[existingLogIndex];
    allLogs[existingLogIndex] = {
      userId: req.userId,
      date,
      weight: logEntry.weight !== undefined ? logEntry.weight : current.weight,
      bodyFat: logEntry.bodyFat !== undefined ? logEntry.bodyFat : current.bodyFat,
      calories: logEntry.calories !== undefined ? logEntry.calories : current.calories,
      workoutDone: workoutDone !== undefined ? logEntry.workoutDone : current.workoutDone
    };
  } else {
    // Fill in defaults from user's latest entry if missing to maintain graph stability
    const userLogs = allLogs.filter(log => log.userId === req.userId);
    if (userLogs.length > 0) {
      userLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
      const latest = userLogs[userLogs.length - 1];
      if (logEntry.weight === undefined) logEntry.weight = latest.weight;
      if (logEntry.bodyFat === undefined) logEntry.bodyFat = latest.bodyFat;
      if (logEntry.calories === undefined) logEntry.calories = 2000; // Default goal
    }
    allLogs.push(logEntry);
  }

  db.logs = allLogs;
  writeDb(db);

  res.status(200).json({ message: 'Log recorded successfully', entry: logEntry });
});

// --- HELPER MOCK GENERATORS ---

function generateMockRoutine(goal, days, level, equipment) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const routine = [];
  
  // Decide exercise list based on equipment
  const lowerExercises = equipment === 'bodyweight' 
    ? [
        { name: 'Bodyweight Squats', sets: 4, reps: '20 reps', rest: '60s', coachingCue: 'Focus on depth, thighs parallel to floor.' },
        { name: 'Glute Bridges', sets: 3, reps: '15 reps', rest: '45s', coachingCue: 'Squeeze glutes at the top of the lift.' },
        { name: 'Lunges', sets: 3, reps: '12 per leg', rest: '60s', coachingCue: 'Keep front knee aligned with your ankle.' }
      ]
    : [
        { name: 'Barbell Squats', sets: 4, reps: '8-10 reps', rest: '90s', coachingCue: 'Drive knees out, keep chest upright.' },
        { name: 'Romanian Deadlifts', sets: 3, reps: '10-12 reps', rest: '90s', coachingCue: 'Hinge at the hips, keep back straight.' },
        { name: 'Leg Press', sets: 3, reps: '10 reps', rest: '75s', coachingCue: 'Control the descent, do not lock knees.' }
      ];

  const upperExercises = equipment === 'bodyweight'
    ? [
        { name: 'Push-ups', sets: 4, reps: '15 reps', rest: '60s', coachingCue: 'Keep body in straight line, elbows tucked.' },
        { name: 'Pike Push-ups', sets: 3, reps: '10 reps', rest: '60s', coachingCue: 'Hips high, head descends between hands.' },
        { name: 'Doorway Rows', sets: 3, reps: '12 reps', rest: '60s', coachingCue: 'Pull through your elbows, squeeze back.' }
      ]
    : [
        { name: 'Dumbbell Bench Press', sets: 4, reps: '8-10 reps', rest: '90s', coachingCue: 'Bring dumbbells to mid-chest level.' },
        { name: 'Dumbbell Rows', sets: 3, reps: '10-12 reps', rest: '75s', coachingCue: 'Pull dumbbell toward your hip.' },
        { name: 'Overhead Press', sets: 3, reps: '8 reps', rest: '90s', coachingCue: 'Lock core, press overhead without leaning back.' }
      ];

  const cardioExercises = [
    { name: 'HIIT Burpees', sets: 4, reps: '45s work', rest: '15s', coachingCue: 'Explode upward on the jump.' },
    { name: 'Mountain Climbers', sets: 3, reps: '40s work', rest: '20s', coachingCue: 'Keep hips low, drive knees fast.' },
    { name: 'High Knees', sets: 3, reps: '30s work', rest: '15s', coachingCue: 'Pump arms, bring knees to waist level.' }
  ];

  let workoutIndex = 0;
  for (let i = 0; i < 7; i++) {
    const day = dayNames[i];
    const isWorkoutDay = i < days;

    if (isWorkoutDay) {
      let name = '';
      let exercises = [];
      if (workoutIndex % 3 === 0) {
        name = 'Upper Body Power';
        exercises = upperExercises;
      } else if (workoutIndex % 3 === 1) {
        name = 'Lower Body Strength';
        exercises = lowerExercises;
      } else {
        name = 'HIIT Cardio Burn';
        exercises = cardioExercises;
      }
      routine.push({ day, name, exercises });
      workoutIndex++;
    } else {
      routine.push({
        day,
        name: 'Rest & Mobility Recovery',
        exercises: [
          { name: 'Foam Rolling / Static Stretching', sets: 1, reps: '15 min', rest: 'N/A', coachingCue: 'Breathe deeply, hold stretches for 30s.' }
        ]
      });
    }
  }

  return {
    title: `Mock ${level.charAt(0).toUpperCase() + level.slice(1)} ${goal.charAt(0).toUpperCase() + goal.slice(1)} Program`,
    overview: `A customized ${days}-day routine utilizing ${equipment} exercises, tailored for ${level} level focusing on ${goal}. (GEMINI MOCK MODE)`,
    routine
  };
}

function generateMockFoodScan() {
  const dishes = [
    {
      dish: 'Chicken Avocado Salad',
      calories: 420,
      servingSize: '1 large plate (~350g)',
      protein: 34,
      carbs: 12,
      fat: 26,
      ingredients: ['Grilled chicken breast', 'Hass avocado', 'Mixed salad greens', 'Olive oil dressing', 'Cherry tomatoes'],
      advice: 'Excellent high-protein, low-carb choice! The healthy fats from avocado will keep you full.'
    },
    {
      dish: 'Grilled Salmon with Quinoa & Broccoli',
      calories: 550,
      servingSize: '1 meal container (~400g)',
      protein: 38,
      carbs: 45,
      fat: 20,
      ingredients: ['Atlantic salmon', 'Red quinoa', 'Steamed broccoli', 'Lemon juice', 'Garlic butter'],
      advice: 'Superb post-workout meal! Filled with clean carbs and rich Omega-3 fatty acids for muscle recovery.'
    },
    {
      dish: 'Oatmeal with Banana & Almonds',
      calories: 380,
      servingSize: '1 bowl (~250g cooked)',
      protein: 11,
      carbs: 62,
      fat: 9,
      ingredients: ['Rolled oats', 'Almond milk', 'Banana slices', 'Almond slivers', 'Honey drizzle'],
      advice: 'Great pre-workout breakfast! High in complex carbohydrates to fuel an intense session.'
    }
  ];

  return dishes[Math.floor(Math.random() * dishes.length)];
}

// Start the server
app.listen(PORT, () => {
  console.log(`FitAI backend running at http://localhost:${PORT}`);
  console.log(`API key configured: ${hasValidApiKey() ? 'YES' : 'NO (Using Simulator Mode)'}`);
});
