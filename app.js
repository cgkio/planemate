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
const AIRTABLE_TABLE_NAME = "planemate_contact";
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
    macaddress
      .one("wlan0")
      .then((mac) => {
        console.log(`MAC address: ${mac}`);
        base("planemates_door_assignment")
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
              log(
                "Monitoring " +
                  sensor1Name +
                  " and " +
                  sensor2Name +
                  " and " +
                  sensor3Name +
                  " and " +
                  sensor4Name +
                  " on Dock " +
                  dockNumber
              );
              resolve();
            } else {
              console.error("No door assignment found for this MAC address.");
              process.exit(1);
            }
          });
      })
      .catch((error) => {
        console.error("Error getting door assignment:", error);
        reject(error);
      });
  });
}

// Function used to monitor contact sensors
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
          var themessage =
            `Door ${sensorName} opened at ` + moment().format("LTS");
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
              // Call your custom function for valid door event
              handleValidDoorEvent(sensorName, sensorBuffer, doorOpenTime);
            } else {
              console.log(`Invalid door event: ${sensorName}`);
              themessage = `Door ${sensorName} closed and was not deemed a boarding operation because it was open for only ${
                doorOpenTime / 1000
              } seconds.`;
              pushFirebase(themessage);
            }
            sensorBuffer.push(moment().valueOf()); // Add door close timestamp
          }
        }
      }
    }, 100); // 100 ms debounce period
  });
}

function handleValidDoorEvent(sensorName, sensorBuffer, doorOpenTime) {
  // Perform actions based on being a valid door event
  // This function will be called when a door event is considered valid
  console.log(`Handling valid door event: ${sensorName}`);

  // Check if boarding is complete
  if (sensorName === sensor1Name || sensorName === sensor2Name) {
    // Either door of the pair A is closed
    if (
      (sensor1Buffer.length === 2 && sensor2Buffer.length === 1) ||
      (sensor1Buffer.length === 1 && sensor2Buffer.length === 2)
    ) {
      console.log("Waiting for the other door to close to complete boarding.");
      return;
    }
  } else if (sensorName === sensor3Name || sensorName === sensor4Name) {
    // Either door of the pair B is closed
    if (
      (sensor3Buffer.length === 2 && sensor4Buffer.length === 1) ||
      (sensor3Buffer.length === 1 && sensor4Buffer.length === 2)
    ) {
      console.log("Waiting for the other door to close to complete boarding.");
      return;
    }
  } else {
    // Add your code here for actions when boarding is deemed complete
    themessage = `Boarding completed at door ${sensorName} (${
      doorOpenTime / 1000
    } seconds).`;
    pushFirebase(themessage);
    // add record in AirTable
    if (doorOpenDuration > falsePositiveDoorOpening) {
      // Only process a record if the door was open for more than 10 seconds
      const fields = {
        "Door Number": sensorName,
        "Door Open": openTimestamp,
        "Door Close": closeTimestamp,
        "Door Open Duration": doorOpenDuration,
        // "Passengers Counted": peopleCount - 1,
        // "Boarding Start": firstPassengerTimestamp,
        // "Boarding Stop": lastPassengerTimestamp,
        // boardingDuration: boardingDuration,
        // "PlaneMate On-Time": planeMateOnTime,
      };
      // if (
      //   lastTurnaroundTime !== null &&
      //   lastTurnaroundTime < turnaroundReset * 60
      // ) {
      //   fields["Turnaround Time"] = lastTurnaroundTime;
      //   db.ref(`lastTransaction/turnaroundTime`).set(lastTurnaroundTime);
      // } else {
      //   // fields["Turnaround Time"] = "N/A";
      //   db.ref(`lastTransaction/turnaroundTime`).set("N/A");
      // }
      addAirtableRecord(fields).then(() => {
        log("AirTable record added");
      });
  }
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

// function to add a record to Airtable
async function addAirtableRecord(fields) {
  fields["Dock Number"] = dockNumber;
  fields["Door Number"] = doorNumber;
  try {
    const response = await axios.post(`/${AIRTABLE_TABLE_NAME}`, {
      records: [
        {
          fields: fields,
        },
      ],
    });
    log("Record added to Airtable");
  } catch (error) {
    console.error("Error adding record to Airtable:", error);
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
