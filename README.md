# Event Registration System

A simple REST API with a plain HTML frontend for managing event registrations.

## Tech Stack
- **Backend:** Node.js, Express
- **Storage:** JSON file (`data/db.json`)
- **Frontend:** Plain HTML, CSS, vanilla JavaScript

## Setup & Run

```bash
npm install
node server.js
```

The browser will open automatically at `http://localhost:3000`

## Features

- Create events with name, total seats, and date
- Register users for events with duplicate and capacity checks
- View events with available seats and registration count
- Filter upcoming events and sort by date
- Cancel registrations; seat is restored automatically

## Project Structure

```
event-registration/
├── server.js          
├── package.json
├── data/
│   └── db.json        
└── public/
    ├── index.html
    ├── create.html
    ├── register.html
    ├── view.html
    ├── cancel.html
    └── style.css
```
