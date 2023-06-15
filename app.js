// A Raspberry Pi used to monitor PlaneMates, a type of transportation at Washington Dulles International Airport.

const rpio = require("rpio");
const axios = require("axios");
const macaddress = require("macaddress");
const firebaseAdmin = require("firebase-admin");
const moment = require("moment");
const Gpio = require("pigpio").Gpio;
const Airtable = require("airtable");

rpio.init({
  gpiomem: true,
});

// AirTable setup
const airtableconfig = require("./airtable.json");
const AIRTABLE_API_KEY = airtableconfig.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = airtableconfig.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = "Door Log";
// Initialize Airtable
const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// Axios setup
axios.defaults.baseURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
axios.defaults.headers.common["Authorization"] = `Bearer ${AIRTABLE_API_KEY}`;
axios.defaults.headers.post["Content-Type"] = "application/json";

//Firebase setup
const serviceAccount = require("./firebase.json");
const { first } = require("lodash");
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://planemate-4aabc-default-rtdb.firebaseio.com/",
});
const db = firebaseAdmin.database();

// Raspberry Pi 4 pin assignments
const DOOR_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
const DOOR_2_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
const DOOR_3_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
const DOOR_4_SENSOR_PIN = 12; // magnetic contact switch (door sensor)

// Global variables
let doLogStuff = true;
let isOpen = null;
let oldIsOpen = null;
let doorOpenTime = null;
let dockNumber = null;
let doorNumber = null;
let doorCloseTime = null;
let lastTurnaroundTime = null;
let timestampBuffer = [];
let planeMateOnTime = false; // Set to false by default

let intervalId;

// Global variables for configuring algorithms
let turnaroundReset; // Number of minutes to wait before restarting PlaneMate procedures (for calculating turnaround time).
let doorCycleTrigger; // The number of door open/close cycles performed before recalculating KPIs.
let falsePositiveDoorOpening; //The number of seconds that must elapse before the door opens is deemed a valid loading operation.
let onTimeDeterminationLimit; // Number of seconds before passenger boarding on the first PlaneMate will not trigger an on-time warning.

// Initialize the GPIO pins
rpio.init({ gpiomem: false });
rpio.open(DOOR_SENSOR_PIN, rpio.INPUT, rpio.PULL_UP);

// functions to handle debugging logs
function log(message) {
  if (doLogStuff === true) {
    console.log(message);
  }
}

// startup function to understand which dock the device is assigned to
async function getDoorAssignment() {
  try {
    const mac = await macaddress.one("wlan0");
    log(`MAC address: ${mac}`);
    const response = await axios.get("/Door%20Assignments", {
      params: {
        filterByFormula: `AND({MAC Address} = '${mac}')`,
      },
    });
    if (response.data.records.length > 0) {
      dockNumber = response.data.records[0].fields["Dock Number"];
      doorOneNumber = response.data.records[0].fields["Door One"];
      doorTwoNumber = response.data.records[0].fields["Door Two"];
      doorThreeNumber = response.data.records[0].fields["Door Three"];
      doorFourNumber = response.data.records[0].fields["Door Four"];
    } else {
      console.error("No door assignment found for this MAC address.");
      process.exit(1);
    }
  } catch (error) {
    console.error(
      "Error getting door assignment:",
      error.response.data || error
    );
    process.exit(1);
  }
}

// // Capture 'SIGINT' signal and call the cleanupLights function
// process.on("SIGINT", cleanupLights);

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
}

// function that polls the door sensor every 100 milliseconds for open/close status
function pollSensor() {
  oldIsOpen = isOpen;
  isOpen = rpio.read(DOOR_SENSOR_PIN);
  if (isOpen && isOpen !== oldIsOpen) {
    log("Door One - OPEN"); // door has been detected to be open
    timestampBuffer.push(Date.now()); // add first timestamp to the buffer for when the door opened
  } else if (isOpen !== oldIsOpen) {
    log("Door One - CLOSED"); // door has been detected to be closed
    timestampBuffer.push(Date.now()); // add the current timestamp to the buffer as the door closed time
    const openTimestamp = new Date(timestampBuffer[0]).toISOString();
    const closeTimestamp = new Date(timestampBuffer[1]).toISOString();
    const boardingDuration = (lastPassengerTimestamp - firstPassengerTime) / 1000;
    log(timestampBuffer)
    log(openTimestamp);
    log(closeTimestamp);
    log(boardingDuration);
  }
  setTimeout(pollSensor, 100);
}

// function to update the main broadcast message in Firebase
async function updateMainMsg(message) {
  try {
    var messageUpdate = {};
    messageUpdate.main = message;
    messageUpdate.updated = moment().format();
    await db.ref("message").set(messageUpdate);
    log(`Main message updated in Firebase: ${message}`);
  } catch (error) {
    console.error(`Error updating main message in Firebase:`, error);
  }
}

// Calculate KPI data from Airtable
async function calculateAverage(fieldName, isTime) {
  let records;
  try {
    records = await base(AIRTABLE_TABLE_NAME)
      .select({
        maxRecords: 100,
        view: "Grid view",
        filterByFormula: `AND(IS_AFTER({Door Close}, DATEADD(NOW(), -30, 'days')), NOT({${fieldName}} = ''))`,
      })
      .all();
  } catch (error) {
    console.error("Error fetching data from Airtable:", error);
    return;
  }
  let sum = 0;
  let count = 0;
  for (let record of records) {
    sum += Number(record.get(fieldName));
    count++;
  }
  let avg = sum / count;
  if (isTime) {
    return moment.utc(avg * 1000).format("mm:ss");
  } else {
    // Round average load to 2 decimal places
    return avg.toFixed(2);
  }
}

// Calculate the percentage of on-time PlaneMate arrivals
async function calculateOnTimePercentage(fieldName) {
  let records;
  try {
    records = await base(AIRTABLE_TABLE_NAME)
      .select({
        maxRecords: 100,
        view: "Grid view",
        filterByFormula: `AND(IS_AFTER({Door Close}, DATEADD(NOW(), -30, 'days')), NOT({${fieldName}} = ''))`,
      })
      .all();
  } catch (error) {
    console.error("Error fetching data from Airtable:", error);
    return;
  }

  let yesCount = 0;
  let noCount = 0;

  for (let record of records) {
    let response = record.get(fieldName);
    if (response === "Yes") {
      yesCount++;
    } else if (response === "No") {
      noCount++;
    }
  }

  // Calculate percentage of "Yes" responses, rounded to two decimal places
  let percentage = ((yesCount / (yesCount + noCount)) * 100).toFixed(2);

  return percentage + "%";
}

// Store KPI data in Firebase
async function storeData(url, fieldName, isTime = false, isPercentage = false) {
  let result;
  try {
    if (isPercentage) {
      result = await calculateOnTimePercentage(fieldName);
    } else {
      result = await calculateAverage(fieldName, isTime);
    }
  } catch (error) {
    console.error("Error calculating data:", error);
    return;
  }

  let ref = db.ref(url);
  ref.set(result).catch((error) => {
    console.error("Error updating Firebase:", error);
  });
}

// primary function that runs when the program starts
async function main() {
  await getDoorAssignment();
  pollSensor();
}

// Fetch global variables from Firebase
db.ref("variables")
  .once("value")
  .then((snapshot) => {
    const data = snapshot.val();
    initialDoorOpenDelay = data.initialDoorOpenDelay;
    turnaroundReset = data.turnaroundReset;
    KPIrecalulation = data.KPIrecalulation;
    falsePositiveDoorOpening = data.falsePositiveDoorOpening;
    onTimeDeterminationLimit = data.onTimeDeterminationLimit;

    // Call the main function
    main();
  })
  .catch((error) => {
    console.error("Error reading Firebase data: ", error);
  });
