// A Raspberry Pi used to monitor PlaneMates, a type of transportation at Washington Dulles International Airport.

const rpio = require("rpio");
const macaddress = require("macaddress");
const firebaseAdmin = require("firebase-admin");
const moment = require("moment");
const Gpio = require("pigpio").Gpio;
const Airtable = require("airtable");

// AirTable setup
const airtableconfig = require("./airtable.json");
const AIRTABLE_API_KEY = airtableconfig.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = airtableconfig.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = "Door Log";
const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

//Firebase setup
const serviceAccount = require("./firebase.json");
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://planemate-4aabc-default-rtdb.firebaseio.com/",
});
const db = firebaseAdmin.database();

// Raspberry Pi 4 pin assignments
var sensorPinNo1 = 18;
var sensorPinNo2 = 24;
var sensorPinNo3 = 1;
var sensorPinNo4 = 12;

// Global variables
let doLogStuff = true;
let dockNumber = null;
var sensor1Name = null;
var sensor2Name = null;
var sensor3Name = null;
var sensor4Name = null;
var sensor1Buffer = [];
var sensor2Buffer = [];
var sensor3Buffer = [];
var sensor4Buffer = [];

// Global variables for configuring algorithms
let turnaroundReset; // Number of minutes to wait before restarting PlaneMate procedures (for calculating turnaround time).
let KPIrecalulation; // The number of door open/close cycles performed before recalculating KPIs.
let falsePositiveDoorOpening; //The number of minutes that must elapse before the door opens is deemed a valid loading operation.
let testStatus; //Allows for Firebase-only operations w/ no database submissions

// Create new Gpio objects for the contact sensors
var sensor1 = new Gpio(sensorPinNo1, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE,
});

var sensor2 = new Gpio(sensorPinNo2, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE,
});

var sensor3 = new Gpio(sensorPinNo3, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE,
});

var sensor4 = new Gpio(sensorPinNo4, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE,
});

// functions to handle debugging logs
function log(message) {
  if (doLogStuff === true) {
    console.log(message);
  }
}

// startup function to understand which dock the device is assigned to
async function getDoorAssignment() {
  return new Promise((resolve, reject) => {
    macaddress.one("wlan0").then((mac) => {
      console.log(`MAC address: ${mac}`);
      base('Door Assignments')
        .select({
          filterByFormula: `AND({MAC Address} = '${mac}')`,
          maxRecords: 1,
        })
        .firstPage((error, records) => {
          if (error) {
            console.error("Error getting door assignment:", error);
            reject(error);
          }
          if (records.length > 0) {
            dockNumber = records[0].get("Dock Number");
            sensor1Name = records[0].get("Door One");
            sensor2Name = records[0].get("Door Two");
            sensor3Name = records[0].get("Door Three");
            sensor4Name = records[0].get("Door Four");
            log("Monitoring " + sensor1Name + " and " + sensor2Name + " and " + sensor3Name + " and " + sensor4Name + " on Dock " + dockNumber);
            resolve();
          } else {
            console.error("No door assignment found for this MAC address.");
            process.exit(1);
          }
        });
    }).catch((error) => {
      console.error("Error getting door assignment:", error);
      reject(error);
    });
  });
}

// Create a function that is used to monitor all contact sensors
// function handleInterrupt(sensor, sensorName, previousState, sensorBuffer) {
//   var debounceTimeout = null;

//   sensor.on("interrupt", function (level) {
//     if (debounceTimeout) clearTimeout(debounceTimeout);

//     debounceTimeout = setTimeout(function () {
//       if (level !== previousState) {
//         console.log(`Door ${sensorName} - ${level === 0 ? "Open" : "Closed"}`);
//         previousState = level;

//         if (level === 0) {
//           // Door opened
//           sensorBuffer.length = 0; // Reset the buffer
//           sensorBuffer.push(moment().valueOf()); // Add door open timestamp
//           db.ref(`doors/Door${sensorName}`).set(false); // Update the door status in Firebase as open
//           var themessage = `Door ${sensorName} opened at ` + moment().format('LTS');
//           pushFirebase(themessage);
//         } else {
//           // Door closed
//           db.ref(`doors/Door${sensorName}`).set(true); // Update the door status in Firebase as open
//           if (sensorBuffer.length === 1) {
//             // Only calculate duration if an open timestamp exists
//             const doorOpenTime = moment().diff(moment(sensorBuffer[0]));
//             var themessage = `Door ${sensorName} closed and was open for ${doorOpenTime / 1000} seconds.`;
//             pushFirebase(themessage);
//             sensorBuffer.push(moment().valueOf()); // Add door close timestamp
//           }
//         }
//       }
//     }, 100); // 100 ms debounce period
//   });
// }
function handleInterrupt(sensor, sensorName, previousState, sensorBuffer) {
  var debounceTimeout = null;

  sensor.on("interrupt", function (level) {
    if (debounceTimeout) clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(function () {
      if (level !== previousState) {
        console.log(`Door ${sensorName} - ${level === 0 ? "Open" : "Closed"}`);
        previousState = level;

        if (level === 0) {
          // Door opened
          sensorBuffer.length = 0; // Reset the buffer
          sensorBuffer.push(moment().valueOf()); // Add door open timestamp
          db.ref(`doors/Door${sensorName}`).set(false); // Update the door status in Firebase as open
          var themessage = `Door ${sensorName} opened at ` + moment().format('LTS');
          pushFirebase(themessage);
        } else {
          // Door closed
          if (sensorBuffer.length === 1) {
            // Only calculate duration if an open timestamp exists
            const doorOpenTime = moment().diff(moment(sensorBuffer[0]));
            db.ref(`doors/Door${sensorName}`).set(true); // Update the door status in Firebase as closed
            var themessage = "";
            // Check if the door event is valid
            if (doorOpenTime >= falsePositiveDoorOpening * 60 * 1000) {
              // Valid door event, do something here
              console.log(`Valid door event: ${sensorName}`);
              themessage = `Boarding done at door ${sensorName} (${doorOpenTime / 1000} seconds.)`;
              // Call your custom function for valid door event
              handleValidDoorEvent(sensorName);
            } else {
              console.log(`Invalid door event: ${sensorName}`);
              themessage = `Door ${sensorName} closed and was only open for ${doorOpenTime / 1000} seconds.`;
            }
            pushFirebase(themessage);
            sensorBuffer.push(moment().valueOf()); // Add door close timestamp
          }
        }
      }
    }, 100); // 100 ms debounce period
  });
}

function handleValidDoorEvent(sensorName) {
  // Custom logic for valid door event
  // Perform actions based on the valid door event
  // This function will be called when a door event is considered valid
  console.log(`Handling valid door event: ${sensorName}`);
  // Add your code here
}

// Firebase reference for sidebar log
const lastTenRef = db.ref("runningLog/lastTen");

// Remove the oldest entry if there are more than 10 entries
lastTenRef.on("value", (snapshot) => {
  if (snapshot.numChildren() > 10) {
    let childCount = 0;
    const updates = {};
    snapshot.forEach((childSnapshot) => {
      if (++childCount <= snapshot.numChildren() - 10) {
        updates[childSnapshot.key] = null;
      }
    });
    lastTenRef.update(updates);
  }
});

// function for pushing messages to sidebar
function pushFirebase(message) {
  console.log(message);
  const logEntry = {
    message: message,
    timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP,
  };
  lastTenRef.push(logEntry);
}

// primary function that runs when the program starts
async function main() {
  await getDoorAssignment();

  handleInterrupt(sensor1, sensor1Name, sensor1.digitalRead(), sensor1Buffer);
  console.log(
    `Door ${sensor1Name} - ${sensor1.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor2, sensor2Name, sensor2.digitalRead(), sensor2Buffer);
  console.log(
    `Door ${sensor2Name} - ${sensor2.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor3, sensor3Name, sensor3.digitalRead(), sensor3Buffer);
  console.log(
    `Door ${sensor3Name} - ${sensor3.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor4, sensor4Name, sensor4.digitalRead(), sensor4Buffer);
  console.log(
    `Door ${sensor4Name} - ${sensor4.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  setInterval(function () {}, 1000);
}

// Fetch global variables from Firebase
db.ref("variables")
  .once("value")
  .then((snapshot) => {
    const data = snapshot.val();
    turnaroundReset = data.turnaroundReset;
    KPIrecalulation = data.KPIrecalulation;
    falsePositiveDoorOpening = data.falsePositiveDoorOpening;
    testStatus = data.testStatus;

    // Console log the new values
    console.log("New values fetched from Firebase:");
    console.log("falsePositiveDoorOpening:", falsePositiveDoorOpening);
    console.log("KPIrecalulation:", KPIrecalulation);
    console.log("turnaroundReset:", turnaroundReset);
    console.log("testStatus:", testStatus);

    // Call the main function
    main();
  })
  .catch((error) => {
    console.error("Error reading Firebase data: ", error);
  });