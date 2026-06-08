const express = require("express");        
const fs = require("fs");                      // File system module for reading/writing JSON file
const path = require("path");                  // Path module for handling file paths
const { v4: uuidv4 } = require("uuid");        // create uninque ID for every event and user registration

const app = express();                         // our app 
const PORT = 3000;


const DB_PATH = path.join(__dirname, "data", "db.json");  // path to our data/db.json file 

app.use(express.static(path.join(__dirname, "public"))); // Serve static files from the "public" directory where our frontend files are stored. 

app.use(express.json());                                // convert incoming JSON request bodies into JS objects

function readDB() {                                     // Read the db.json file 
  const raw = fs.readFileSync(DB_PATH, "utf-8");        // read synchronously as string and return js object
  return JSON.parse(raw);                               
}

function writeDB(data) {                               //takes Js data, converts it into JSON format, and saves it into db.json.
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

let isLocked = false;                                  // OS mutex lock concept. If true, another request is currently modifying db.json so other requests must wait.
const lockQueue = [];                                  // Queue of pending requests waiting for the lock. FIFO. 

function acquireLock() {
  return new Promise((resolve) => {                   // If lock is free, acquire it immediately. Otherwise, queue the request.
    if (!isLocked) {
      isLocked = true;
      resolve();
    } else {
      lockQueue.push(resolve);
    }
  });
}

function releaseLock() {                             // Release the lock and give it to the next waiting request if any.
  if (lockQueue.length > 0) {
    const next = lockQueue.shift();
    next(); 
  } else {   
    isLocked = false;
  }
}

app.post("/api/events", async (req, res) => {           // create new event. Async because we have to acquire the lock before modifying db.json
  const { name, total_seats, event_date } = req.body;   //destructurinng the data from the request body. 

  if (!name || total_seats === undefined || total_seats === "" || !event_date) {    //validation
    return res.status(400).json({ error: "name, total_seats, and event_date are all required." });
  }

  const trimmedName = String(name).trim();               //trimming whitespace. 
  if (trimmedName === "") {
    return res.status(400).json({ error: "Event name cannot be blank." });
  }

  const seats = Number(total_seats);                    // Convert to number and validate
  if (!Number.isInteger(seats) || seats <= 0) {
    return res.status(400).json({ error: "Total seats must be a whole number greater than 0." });
  }

  const eventDate = new Date(event_date);              // Validate date
  if (isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: "Entered date is not a valid date." });
  }
  if (eventDate.getTime() <= Date.now()) {            
    return res.status(400).json({ error: "Event date must be in the future." });
  }

  await acquireLock();                               // Acquire lock to ensure no two requests can create events at the same time
  try {
    const db = readDB();

    const duplicate = db.events.find(                // Duplicate validation
      (e) => e.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ error: `An event named "${trimmedName}" already exists.` });
    }

    const newEvent = {
      id: uuidv4(),                                 //unique ID for the event
      name: trimmedName, 
      total_seats: seats,
      available_seats: seats, // decremented on each registration
      event_date: eventDate.toISOString(),
      created_at: new Date().toISOString(),
    };

    db.events.push(newEvent);                     // Add new event to the database and save
    writeDB(db);

    return res.status(201).json({ message: "Event created successfully.", event: newEvent });
  } finally {
    releaseLock();                               
  }
});


app.post("/api/registrations", async (req, res) => {
  const { user_name, event_id } = req.body;       

  if (!user_name || !event_id) {
    return res.status(400).json({ error: "Your Name and Event name are required." });
  }

  const trimmedUser = String(user_name).trim();
  if (trimmedUser === "") {
    return res.status(400).json({ error: "Name cannot be blank." });
  }

  await acquireLock();          // avoiding race conditions
  try {
    const db = readDB();

    const event = db.events.find((e) => e.id === event_id);
    if (!event) {               // to avoid custom script despite having dropdown on frontend.
      return res.status(404).json({ error: "Event not found." });
    }

    const existingReg = db.registrations.find(     // Check if the user is already registered for this event.
      (r) =>
        r.event_id === event_id &&
        r.user_name.toLowerCase() === trimmedUser.toLowerCase() &&
        r.status === "active"
    );
    if (existingReg) { 
      return res.status(409).json({ error: `${trimmedUser} is already registered for this event.` });
    }

    if (event.available_seats <= 0) {
      return res.status(400).json({ error: "This event is full. No seats available." });
    }

    event.available_seats -= 1;

    const newReg = {                       // register user for the event and save to db.json
      id: uuidv4(),
      event_id: event.id,
      event_name: event.name,
      user_name: trimmedUser,
      status: "active",
      registered_at: new Date().toISOString(), 
    };

    db.registrations.push(newReg);
    writeDB(db);

    return res.status(201).json({ message: "You are registered successfully.", registration: newReg });
  } finally {
    releaseLock();
  }
});


app.get("/api/events", (req, res) => {
  const db = readDB();
  const now = new Date();         // to check upcoming events. 

  let events = db.events.map((event) => {
    
    const totalRegistrations = db.registrations.filter(         //count total active registrations for this event to return in the response.
      (r) => r.event_id === event.id && r.status === "active"
    ).length;

    return {                     // return event details along with live calculated fields
      id: event.id,
      name: event.name,
      event_date: event.event_date,
      total_seats: event.total_seats,
      available_seats: event.available_seats,
      total_registrations: totalRegistrations,
      is_upcoming: new Date(event.event_date) > now,
    };
  });

  
  events = events.filter(e => e.is_upcoming);  // show upcoming events and dispplay in chronological order.
  events.sort(
    (a, b) => new Date(a.event_date) - new Date(b.event_date)
  );

  return res.json({ events });
});

app.get("/api/events/:id", (req, res) => {       // Get event details by ID, including total active registrations. Used for the registration page to show event info and remaining seats.
  const db = readDB();
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ error: "Event not found." });
  }
  return res.json({ event });
});


app.delete("/api/registrations/:id", async (req, res) => {
  await acquireLock();
  try {
    const db = readDB();

    const reg = db.registrations.find((r) => r.id === req.params.id);   // find the registration by ID. 

    if (!reg) {
      return res.status(404).json({ error: "Registration not found." });  // if not found, return 404
    }

    if (reg.status === "cancelled") {                    
      return res.status(400).json({ error: "This registration is already cancelled." });
    }

    reg.status = "cancelled";
    reg.cancelled_at = new Date().toISOString();
    
    const event = db.events.find((e) => e.id === reg.event_id);
    if (event) {
      event.available_seats += 1;                               // Increment available seats for the event when a registration is cancelled.
      if (event.available_seats > event.total_seats) {          
        event.available_seats = event.total_seats;
      }
    }

    writeDB(db);

    return res.json({ message: "Your registration is cancelled.", registration: reg });
  } finally {
    releaseLock();
  }
});


app.get("/api/registrations", (req, res) => {    // Get all active registrations. Used for the admin page to show all current registrations.
  const db = readDB();
  const active = db.registrations.filter((r) => r.status === "active");
  return res.json({ registrations: active });
});


app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n Server running at ${url}`);
});
