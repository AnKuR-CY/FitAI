const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fitai";

if (!process.env.MONGODB_URI) {
  console.warn("WARNING: MONGODB_URI is not defined in environment variables. Defaulting to local: mongodb://localhost:27017/fitai");
}

// Cached connection promise for serverless functions (Vercel)
let cachedConnection = null;

async function connectDb() {
  if (cachedConnection) {
    return cachedConnection;
  }

  // Set up connection options
  cachedConnection = mongoose.connect(MONGODB_URI).then(mongooseInstance => {
    console.log("Connected to MongoDB Atlas successfully");
    return mongooseInstance;
  }).catch(err => {
    cachedConnection = null;
    console.error("Failed to connect to MongoDB Atlas:", err);
    throw err;
  });

  return cachedConnection;
}

// Schemas & Models
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'user' },
  name: String,
  specialization: String,
  rating: Number
});

const SessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  expiresAt: { type: Number, required: true }
});

const RoutineSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  title: String,
  overview: String,
  routine: Array,
  isMock: Boolean,
  modelUsed: String,
  errorMsg: String
});

const FoodScanSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  date: String,
  timestamp: String,
  dish: String,
  calories: Number,
  protein: Number,
  carbs: Number,
  fat: Number,
  ingredients: [String],
  advice: String,
  isMock: Boolean
});

const WorkoutHistorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  date: String,
  timestamp: String,
  workoutName: String,
  exercisesCount: Number
});

const AppointmentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  slotId: String,
  userId: { type: String, required: true },
  patientName: String,
  doctorId: String,
  doctorName: String,
  therapistName: String,
  date: String,
  time: String,
  status: { type: String, default: 'pending' }
});

const SlotSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  doctorId: { type: String, required: true },
  doctorName: String,
  specialization: String,
  rating: Number,
  date: String,
  time: String,
  booked: { type: Boolean, default: false },
  bookedBy: String
});

const LogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  date: { type: String, required: true },
  weight: Number,
  bodyFat: Number,
  calories: Number,
  workoutDone: { type: Boolean, default: false }
});

// Ensure a user only has one log entry per date
LogSchema.index({ userId: 1, date: 1 }, { unique: true });

const User = mongoose.model('User', UserSchema);
const Session = mongoose.model('Session', SessionSchema);
const Routine = mongoose.model('Routine', RoutineSchema);
const FoodScan = mongoose.model('FoodScan', FoodScanSchema);
const WorkoutHistory = mongoose.model('WorkoutHistory', WorkoutHistorySchema);
const Appointment = mongoose.model('Appointment', AppointmentSchema);
const Slot = mongoose.model('Slot', SlotSchema);
const Log = mongoose.model('Log', LogSchema);

// Seeding Script
async function seedDatabase() {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('Seeding default demo user "demo" with password "demo123"...');
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync('demo123', salt);
      const demoUserId = 'demo-user-id';
      
      await User.create({
        id: demoUserId,
        username: 'demo',
        passwordHash,
        role: 'user'
      });
      
      console.log('Seeding default logs for demo user...');
      await Log.insertMany([
        { userId: demoUserId, date: "2026-05-27", weight: 79.2, bodyFat: 21.9, calories: 1820, workoutDone: true },
        { userId: demoUserId, date: "2026-05-28", weight: 79.0, bodyFat: 21.8, calories: 1950, workoutDone: true },
        { userId: demoUserId, date: "2026-05-29", weight: 78.7, bodyFat: 21.5, calories: 1780, workoutDone: true },
        { userId: demoUserId, date: "2026-05-30", weight: 78.5, bodyFat: 21.4, calories: 2100, workoutDone: false },
        { userId: demoUserId, date: "2026-05-31", weight: 78.4, bodyFat: 21.2, calories: 1860, workoutDone: true },
        { userId: demoUserId, date: "2026-06-01", weight: 78.3, bodyFat: 21.1, calories: 2240, workoutDone: true },
        { userId: demoUserId, date: "2026-06-02", weight: 78.2, bodyFat: 21.0, calories: 1710, workoutDone: true }
      ]);

      console.log('Seeding initial bookings for demo user...');
      await Appointment.create({
        id: "1",
        userId: demoUserId,
        therapistName: "Dr. Ankita Chowdhury",
        doctorName: "Dr. Ankita Chowdhury",
        date: "2026-06-02",
        time: "10:30 AM",
        status: 'pending'
      });
    }

    // Seed doctor if not present
    const docCount = await User.countDocuments({ role: 'doctor' });
    if (docCount === 0) {
      console.log('Seeding default doctor "doctor" with password "doctor123"...');
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync('doctor123', salt);
      const docUserId = 'demo-doctor-id';

      await User.create({
        id: docUserId,
        username: 'doctor',
        passwordHash,
        role: 'doctor',
        name: 'Dr. Ankita Chowdhury',
        specialization: 'Sports Physio · Injury Rehab',
        rating: 4.9
      });

      console.log('Seeding availability slots for default doctor...');
      await Slot.insertMany([
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
      ]);
    }
  } catch (error) {
    console.error('Error during seeding database:', error);
  }
}

module.exports = {
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
};
