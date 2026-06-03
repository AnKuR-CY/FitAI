const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

// Import MongoDB database layer
const {
  connectDb,
  seedDatabase,
  User,
  Session,
  Routine,
  FoodScan,
  WorkoutHistory,
  Appointment,
  Slot,
  Log
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to database middleware on every request (reuses cached connection pool)
app.use(async (req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (error) {
    console.error("Database connection middleware error:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Configure Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['x-authorization'] || req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  try {
    const session = await Session.findOne({ token });

    if (!session) {
      return res.status(403).json({ error: 'Session expired or invalid token. Please log in again.' });
    }

    // Session expiry check
    if (session.expiresAt && Date.now() > session.expiresAt) {
      await Session.deleteOne({ token });
      return res.status(403).json({ error: 'Session expired. Please log in again.' });
    }

    // Attach user identity to request object
    req.userId = session.userId;
    next();
  } catch (err) {
    console.error('Authentication token check failed:', err);
    return res.status(500).json({ error: 'Authentication check failed due to a database error.' });
  }
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
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role, name, specialization, passcode } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const existingUser = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });

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

    const newUser = await User.create({
      id: userId,
      username,
      passwordHash,
      role: finalRole,
      name: finalRole === 'doctor' ? (name || `Dr. ${username}`) : name,
      specialization: finalRole === 'doctor' ? (specialization || 'General Physiotherapist') : undefined,
      rating: finalRole === 'doctor' ? 5.0 : undefined
    });

    // Auto-generate session token so they log in immediately
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days expiry

    await Session.create({ token, userId, expiresAt });

    res.status(201).json({
      token,
      username,
      role: finalRole,
      name: newUser.name,
      specialization: newUser.specialization
    });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Create session
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days expiry

    await Session.create({ token, userId: user.id, expiresAt });

    res.json({
      token,
      username,
      role: user.role || 'user',
      name: user.name,
      specialization: user.specialization
    });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  try {
    if (token) {
      await Session.deleteOne({ token });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout failed:', err);
    res.status(500).json({ error: 'Internal server error during logout' });
  }
});

// 1. ROUTINE ENDPOINTS (USER ISOLATED)
app.get('/api/routine', authenticateToken, async (req, res) => {
  try {
    const userRoutine = await Routine.findOne({ userId: req.userId });
    if (!userRoutine) {
      return res.status(404).json({ error: 'No generated routine found for this user.' });
    }
    res.json(userRoutine);
  } catch (err) {
    console.error('Fetch routine failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching routine' });
  }
});

app.post('/api/routine', authenticateToken, upload.single('photo'), async (req, res) => {
  let { goal, days, level, equipment } = req.body;
  
  if (days) {
    days = parseInt(days, 10);
  }

  if (!goal || !days || !level || !equipment) {
    return res.status(400).json({ error: 'Goal, days, level, and equipment are required' });
  }

  let imagePart = null;
  if (req.file) {
    imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);
  }

  let prompt = `
Generate a weekly fitness workout routine in JSON format.
Parameters:
- Goal: ${goal}
- Days per week: ${days}
- Experience level: ${level}
- Equipment available: ${equipment}
`;

  if (imagePart) {
    prompt += `
- Physique Analysis: You are provided with a photo of the user's physique/body structure. Analyze their posture, physique goals, muscle balance, and body composition from the photo, and customize the exercises and coaching cues specifically to address their individual body structure needs. Focus on optimizing muscle balance, fixing posture issues (e.g. forward head, rounded shoulders, pelvic tilt if visible), or prioritizing specific muscle groups to achieve their desired aesthetics/strength goals. Ensure the routine details/cues specifically mention these physique-based adjustments.
`;
  }

  prompt += `
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
    const result = await generateContentWithFallback(prompt, imagePart);
    const data = JSON.parse(result.text);

    // Delete existing routine and insert new one
    await Routine.deleteOne({ userId: req.userId });

    const savedRoutine = await Routine.create({
      userId: req.userId,
      title: data.title,
      overview: data.overview,
      routine: data.routine,
      isMock: false,
      modelUsed: result.modelUsed
    });

    return res.json(savedRoutine);
  } catch (err) {
    console.error("Gemini Routine generation failed, falling back to mock:", err.message || err);
    
    const mockRoutine = generateMockRoutine(goal, days, level, equipment);
    
    await Routine.deleteOne({ userId: req.userId });

    const savedRoutine = await Routine.create({
      userId: req.userId,
      ...mockRoutine,
      isMock: true,
      errorMsg: err.message
    });

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
    await FoodScan.create({
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
    await FoodScan.create({
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

    return res.json(responseData);
  }
});

// 2.5 USER PERSISTENT HISTORY ROUTING (USER ISOLATED)
app.get('/api/food-scans', authenticateToken, async (req, res) => {
  try {
    const userScans = await FoodScan.find({ userId: req.userId }).sort({ timestamp: -1 });
    res.json(userScans);
  } catch (err) {
    console.error('Fetch food scans failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching food scans' });
  }
});

app.get('/api/workout-history', authenticateToken, async (req, res) => {
  try {
    const userHistory = await WorkoutHistory.find({ userId: req.userId }).sort({ timestamp: -1 });
    res.json(userHistory);
  } catch (err) {
    console.error('Fetch workout history failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching workout history' });
  }
});

app.post('/api/workout-history', authenticateToken, async (req, res) => {
  const { workoutName, exercisesCount, date } = req.body;
  if (!workoutName) {
    return res.status(400).json({ error: 'Workout name is required' });
  }

  try {
    const historyEntry = await WorkoutHistory.create({
      id: Date.now().toString(),
      userId: req.userId,
      date: date || new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      workoutName,
      exercisesCount: exercisesCount || 0
    });

    res.status(201).json(historyEntry);
  } catch (err) {
    console.error('Save workout history failed:', err);
    res.status(500).json({ error: 'Internal server error while saving workout history' });
  }
});

// 3. PHYSIO CLINIC BOOKING & APPOINTMENTS (USER & DOCTOR INTERACTIVE)

// Get patient's appointments
app.get('/api/physio/appointments', authenticateToken, async (req, res) => {
  try {
    const userAppointments = await Appointment.find({ userId: req.userId });
    res.json(userAppointments);
  } catch (err) {
    console.error('Fetch appointments failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching appointments' });
  }
});

// Book a session (Patient only)
app.post('/api/physio/book', authenticateToken, async (req, res) => {
  const { slotId, therapistName, date, time } = req.body;

  try {
    if (slotId) {
      // Find the slot
      const slot = await Slot.findOne({ id: slotId });
      if (!slot) {
        return res.status(404).json({ error: 'Selected time slot was not found or is no longer available.' });
      }
      if (slot.booked) {
        return res.status(400).json({ error: 'This slot has already been booked.' });
      }

      // Mark the slot as booked
      slot.booked = true;
      slot.bookedBy = req.userId;
      await slot.save();
      
      // Fetch patient name
      const patientUser = await User.findOne({ id: req.userId });
      const patientName = patientUser ? patientUser.username : 'Patient';

      const newAppointment = await Appointment.create({
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
      });

      return res.status(201).json(newAppointment);
    } else {
      // Fallback custom slot
      if (!therapistName || !date || !time) {
        return res.status(400).json({ error: 'Missing appointment details (therapistName, date, time)' });
      }

      const doctorUser = await User.findOne({ role: 'doctor', name: { $regex: new RegExp(`^${therapistName}$`, 'i') } });
      const patientUser = await User.findOne({ id: req.userId });

      const newAppointment = await Appointment.create({
        id: Date.now().toString(),
        userId: req.userId,
        patientName: patientUser ? patientUser.username : 'Patient',
        doctorId: doctorUser ? doctorUser.id : null,
        doctorName: therapistName,
        therapistName,
        date,
        time,
        status: 'pending'
      });

      return res.status(201).json(newAppointment);
    }
  } catch (err) {
    console.error('Booking failed:', err);
    res.status(500).json({ error: 'Internal server error during booking' });
  }
});

// Cancel a booking (Patient or Doctor)
app.post('/api/physio/cancel', authenticateToken, async (req, res) => {
  const { appointmentId } = req.body;
  if (!appointmentId) {
    return res.status(400).json({ error: 'Appointment ID is required' });
  }

  try {
    const appointment = await Appointment.findOne({ id: appointmentId });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Verify authorization: caller must be the patient or the doctor
    if (appointment.userId !== req.userId && appointment.doctorId !== req.userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this appointment' });
    }

    // Free up slot if applicable
    if (appointment.slotId) {
      const slot = await Slot.findOne({ id: appointment.slotId });
      if (slot) {
        slot.booked = false;
        slot.bookedBy = null;
        await slot.save();
      }
    }

    await Appointment.deleteOne({ id: appointmentId });

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    console.error('Cancellation failed:', err);
    res.status(500).json({ error: 'Internal server error during cancellation' });
  }
});

// Available slots for patients
app.get('/api/physio/available-slots', async (req, res) => {
  try {
    const available = await Slot.find({ booked: false });
    res.json(available);
  } catch (err) {
    console.error('Fetch available slots failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching slots' });
  }
});

// Doctor specific routes

// Add slot (Doctor only)
app.post('/api/physio/slots', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findOne({ id: req.userId });
    if (!currentUser || currentUser.role !== 'doctor') {
      return res.status(403).json({ error: 'Access denied: Only physiotherapists can manage slots.' });
    }

    const { date, time } = req.body;
    if (!date || !time) {
      return res.status(400).json({ error: 'Date and time are required' });
    }

    const newSlot = await Slot.create({
      id: Date.now().toString(),
      doctorId: req.userId,
      doctorName: currentUser.name || currentUser.username,
      specialization: currentUser.specialization || 'General Physiotherapist',
      rating: currentUser.rating || 5.0,
      date,
      time,
      booked: false,
      bookedBy: null
    });

    res.status(201).json(newSlot);
  } catch (err) {
    console.error('Add slot failed:', err);
    res.status(500).json({ error: 'Internal server error while adding slot' });
  }
});

// Get Doctor slots (Doctor only)
app.get('/api/physio/doctor-slots', authenticateToken, async (req, res) => {
  try {
    const doctorSlots = await Slot.find({ doctorId: req.userId });
    res.json(doctorSlots);
  } catch (err) {
    console.error('Fetch doctor slots failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching doctor slots' });
  }
});

// Delete slot (Doctor only)
app.delete('/api/physio/slots/:id', authenticateToken, async (req, res) => {
  try {
    const slot = await Slot.findOne({ id: req.params.id, doctorId: req.userId });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found or not authorized.' });
    }

    if (slot.booked) {
      await Appointment.deleteMany({ slotId: slot.id });
    }

    await Slot.deleteOne({ id: req.params.id });

    res.json({ message: 'Slot deleted successfully' });
  } catch (err) {
    console.error('Delete slot failed:', err);
    res.status(500).json({ error: 'Internal server error while deleting slot' });
  }
});

// Get doctor bookings (Doctor only)
app.get('/api/physio/doctor-bookings', authenticateToken, async (req, res) => {
  try {
    const docBookings = await Appointment.find({ doctorId: req.userId });
    res.json(docBookings);
  } catch (err) {
    console.error('Fetch doctor bookings failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching doctor bookings' });
  }
});

// Complete/Accept session (Doctor only)
app.post('/api/physio/doctor-bookings/complete', authenticateToken, async (req, res) => {
  const { appointmentId, status } = req.body;
  if (!appointmentId || !status) {
    return res.status(400).json({ error: 'Appointment ID and status are required' });
  }

  try {
    const appointment = await Appointment.findOne({ id: appointmentId, doctorId: req.userId });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found or not authorized' });
    }

    appointment.status = status;
    await appointment.save();

    res.json(appointment);
  } catch (err) {
    console.error('Complete booking failed:', err);
    res.status(500).json({ error: 'Internal server error while updating booking status' });
  }
});

// 4. ANALYTICS & LOGGING (USER ISOLATED)
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const logs = await Log.find({ userId: req.userId }).sort({ date: 1 });

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
  } catch (err) {
    console.error('Fetch dashboard stats failed:', err);
    res.status(500).json({ error: 'Internal server error while fetching dashboard stats' });
  }
});

app.post('/api/dashboard/log', authenticateToken, async (req, res) => {
  const { date, weight, bodyFat, calories, workoutDone } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });
  }

  try {
    const existingLog = await Log.findOne({ date, userId: req.userId });

    const logEntry = {
      userId: req.userId,
      date,
      weight: weight !== undefined ? parseFloat(weight) : undefined,
      bodyFat: bodyFat !== undefined ? parseFloat(bodyFat) : undefined,
      calories: calories !== undefined ? parseInt(calories) : undefined,
      workoutDone: workoutDone !== undefined ? !!workoutDone : false
    };

    if (existingLog) {
      // Merge updates
      existingLog.weight = logEntry.weight !== undefined ? logEntry.weight : existingLog.weight;
      existingLog.bodyFat = logEntry.bodyFat !== undefined ? logEntry.bodyFat : existingLog.bodyFat;
      existingLog.calories = logEntry.calories !== undefined ? logEntry.calories : existingLog.calories;
      existingLog.workoutDone = workoutDone !== undefined ? logEntry.workoutDone : existingLog.workoutDone;
      await existingLog.save();
      
      res.status(200).json({ message: 'Log updated successfully', entry: existingLog });
    } else {
      // Fill in defaults from user's latest entry if missing to maintain graph stability
      const latest = await Log.findOne({ userId: req.userId }).sort({ date: -1 });
      if (latest) {
        if (logEntry.weight === undefined) logEntry.weight = latest.weight;
        if (logEntry.bodyFat === undefined) logEntry.bodyFat = latest.bodyFat;
        if (logEntry.calories === undefined) logEntry.calories = 2000; // Default goal
      }
      
      const newLog = await Log.create(logEntry);
      res.status(200).json({ message: 'Log recorded successfully', entry: newLog });
    }
  } catch (err) {
    console.error('Record progress log failed:', err);
    res.status(500).json({ error: 'Internal server error while recording log' });
  }
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

// Connect to database and seed defaults on startup
connectDb().then(() => {
  seedDatabase();
  
  if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
      console.log(`FitAI backend running at http://localhost:${PORT}`);
      console.log(`API key configured: ${hasValidApiKey() ? 'YES' : 'NO (Using Simulator Mode)'}`);
    });
  }
}).catch(err => {
  console.error("Database connection failed during startup:", err);
});

module.exports = app;
