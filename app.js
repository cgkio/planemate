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
const { first } = require("lodash");
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
let isOpen = null;
let oldIsOpen = null;
let doorOpenTime = null;
let dockNumber = null;
let doorNumber = null;
let doorCloseTime = null;
let lastTurnaroundTime = null;
let timestampBuffer = [];
let planeMateOnTime = false; // Set to false by default

// Global variables for configuring algorithms
var sensor1Name = null;
var sensor2Name = null;
var sensor3Name = null;
var sensor4Name = null;

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
  try {
    const mac = await macaddress.one("wlan0");
    console.log(`MAC address: ${mac}`);

    base('Door Assignments')
      .select({
        .filterByFormula(`AND({'MAC Address'} = '${mac}')`,
        maxRecords: 1,
      })
      .firstPage((error, records) => {
        if (error) {
          console.error("Error getting door assignment:", error);
          process.exit(1);
        }
        if (records.length > 0) {
          console.log(records);
          dockNumber = records[0].get("Dock Number");
          sensor1Name = records[0].get("Door One");
          sensor2Name = records[0].get("Door Two");
          sensor3Name = records[0].get("Door Three");
          sensor4Name = records[0].get("Door Four");
        } else {
          console.error("No door assignment found for this MAC address.");
          process.exit(1);
        }
      });
  } catch (error) {
    console.error("Error getting door assignment:", error);
    process.exit(1);
  }
}

// Create a function that is used to monitor all contact sensors
function handleInterrupt(sensor, sensorName, previousState) {
  var debounceTimeout = null;

  sensor.on("interrupt", function (level) {
    if (debounceTimeout) clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(function () {
      if (level !== previousState) {
        console.log(`${sensorName} - ${level === 0 ? "Open" : "Closed"}`);
        previousState = level;
      }
    }, 100); // 100 ms debounce period
  });
}

// primary function that runs when the program starts
async function main() {
  
  await getDoorAssignment();

  handleInterrupt(sensor1, sensor1Name, sensor1.digitalRead());
  console.log(
    `${sensor1Name} - ${sensor1.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor2, sensor2Name, sensor2.digitalRead());
  console.log(
    `${sensor2Name} - ${sensor2.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor3, sensor3Name, sensor3.digitalRead());
  console.log(
    `${sensor3Name} - ${sensor3.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  handleInterrupt(sensor4, sensor4Name, sensor4.digitalRead());
  console.log(
    `${sensor4Name} - ${sensor4.digitalRead() === 0 ? "Open" : "Closed"}`
  );

  setInterval(function () {}, 1000);

}

main();
