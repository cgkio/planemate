// A Raspberry Pi 4 is used to monitor PlaneMates, a type of transportation at Washington Dulles International Airport.
// Passengers board PlaneMates when a flight departs. When one PlaneMate is full, the entry door closes, the PlaneMate departs, another PlaneMate arrives, and the entry door reopens to allow people to board the PlaneMate.
// The Raspberry Pi will be mounted to the door, with the contact switch monitoring the opening and shutting of the door and the ultrasonic sensor counting passengers as they pass through.

const rpio = require("rpio");
const axios = require("axios");
const macaddress = require("macaddress");
const firebaseAdmin = require("firebase-admin");
const moment = require("moment");
const Gpio = require("pigpio").Gpio;

// Raspberry Pi 4 pin assignments
const DOOR_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
const RED_LIGHT = 21; // red LED light
const YELLOW_LIGHT = 19; // yellow LED light
const GREEN_LIGHT = 23; // green LED light
const trigger = new Gpio(23, { mode: Gpio.OUTPUT }); // HC-SR04 ultrasonic sensor trigger
const echo = new Gpio(24, { mode: Gpio.INPUT, alert: true }); // HC-SR04 ultrasonic sensor echo

// Global variables
let doLogStuff = true;
let isOpen = null;
let oldIsOpen = null;
let doorOpenTime = null;
let dockNumber = null;
let doorNumber = null;
let firstPassengerTime = null;
let secondLastPassengerTime = null;
let doorCloseTime = null;
let lastTurnaroundTime = null;
let intervalId;
let timestampBuffer = [];

// AirTable setup
const airtableconfig = require("./airtable.json");
const AIRTABLE_API_KEY = airtableconfig.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = airtableconfig.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = "Door Log";
axios.defaults.baseURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
axios.defaults.headers.common["Authorization"] = `Bearer ${AIRTABLE_API_KEY}`;
axios.defaults.headers.post["Content-Type"] = "application/json";

//Firebase setup
const serviceAccount = require("./firebase.json");
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://planemate-4aabc-default-rtdb.firebaseio.com/",
});
const db = firebaseAdmin.database();

// Initialize the GPIO pins
rpio.init({ gpiomem: false });
rpio.open(DOOR_SENSOR_PIN, rpio.INPUT, rpio.PULL_UP);
rpio.open(RED_LIGHT, rpio.OUTPUT);
rpio.open(YELLOW_LIGHT, rpio.OUTPUT);
rpio.open(GREEN_LIGHT, rpio.OUTPUT);

// <<START>> HC-SR04 ultrasonic sensor code <<START>>

trigger.digitalWrite(0); // Make sure trigger is low

let startTick;
let baseline;
let personDetected = false;
let peopleCount; // Counter for people detected

// Add a new variable to track consecutive detections
let consecutiveDetections = 0;

echo.on("alert", (level, tick) => {
  if (level == 1) {
    startTick = tick;
  } else {
    const endTick = tick;
    const diff = (endTick >> 0) - (startTick >> 0); // Unsigned 32 bit arithmetic
    let distance = diff / 2 / (1e6 / 34321); // 1e6 / 34321 is the number of microseconds it takes sound to travel 1cm at 20 degrees celcius

    if (baseline === undefined) {
      baseline = distance; // Set the first reading as baseline
      log("baseline distance: " + baseline + " cm");
    } else {
      if (!personDetected && Math.abs(distance - baseline) > 30) {
        consecutiveDetections++;

        if (consecutiveDetections >= 3) {
          log("Person Detected | " + distance + " cm"); // person detected if the distance is more than 30 cm from the baseline
          flashYellowLight();
          personDetected = true;
          peopleCount++; // Increase the counter when a person is detected
          log("Total People Detected: " + peopleCount);
          timestampBuffer.push(Date.now()); // buffer used to identify the timestamp for the first passenger in the flow
          db.ref("lastTransaction/activePassengerCount").set(peopleCount); // update the active passenger count in Firebase
          consecutiveDetections = 0; // reset the consecutive detections

          // Check if there have been three people detected within 60 seconds to confirm passengers have started boarding
          if (
            timestampBuffer.length >= 3 &&
            timestampBuffer[timestampBuffer.length - 1] - timestampBuffer[0] <=
              60000
          ) {
            if (!firstPassengerTime) {
              firstPassengerTime = timestampBuffer[0]; //set the boarding started timestamp to the first person in the flow
              log("Boarding time started at: " + firstPassengerTime, "min");
            }
            
          }
        }
      } else if (personDetected && Math.abs(distance - baseline) <= 30) {
        consecutiveDetections = 0; // reset the consecutive detections if no person is detected
        log("Person has passed");
        personDetected = false;
      }
    }
  }
});

// <<END>> HC-SR04 ultrasonic sensor code <<END>>

// functions to handle debugging logs
function log(message) {
  if (doLogStuff === true) {
    console.log(message);
  }
}

// function to briefly turn on the yellow light
function flashYellowLight() {
  rpio.write(YELLOW_LIGHT, 1); // Turn on the yellow light
  setTimeout(() => {
    rpio.write(YELLOW_LIGHT, 0); // Turn off the yellow light after 1/2 second
  }, 100);
}

// utility function to close out power to GPIO pins when the program exits
function cleanupLights() {
  log("cleaning up the GPIO pins");
  rpio.close(RED_LIGHT);
  rpio.close(YELLOW_LIGHT);
  rpio.close(GREEN_LIGHT);
  rpio.close(DOOR_SENSOR_PIN);
}

// startup function to understand which door the devise is assigned to
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
      doorNumber = response.data.records[0].fields["Door Number"];
      log(
        `Assigned to Dock Number: ${dockNumber}, Door Number: ${doorNumber}`,
        "verbose"
      );
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

// Capture 'SIGINT' signal and call the cleanupLights function
process.on("SIGINT", cleanupLights);

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

// function that ensures the proper open/close light is lit when the program starts and delays the start of the ultrasonic sensor if the door is open
function waitForDoorToClose() {
  isOpen = rpio.read(DOOR_SENSOR_PIN);
  if (isOpen) {
    console.log("Waiting for the door to close...");
    rpio.write(GREEN_LIGHT, 1); // Turn on the green light if the door is open
    setTimeout(waitForDoorToClose, 1000);
  } else {
    console.log("Door is closed. Starting to monitor...");
    rpio.write(RED_LIGHT, 1); // Turn on the red light if the door is closed
    pollSensor();
  }
}

// function that turns off all LED lights
function turnOffAllLights() {
  rpio.write(RED_LIGHT, 0);
  rpio.write(YELLOW_LIGHT, 0);
  rpio.write(GREEN_LIGHT, 0);
}

// function that polls the door sensor every 100 milliseconds for open/close status
function pollSensor() {
  oldIsOpen = isOpen;
  isOpen = rpio.read(DOOR_SENSOR_PIN);
  if (isOpen && isOpen !== oldIsOpen) {
    console.log("PlaneMate Door OPEN"); // door has been detected to be open
    peopleCount = 0; // reset the people counter
    db.ref("lastTransaction/activePassengerCount").set(0); // reset the active passenger count in Firebase
    timestampBuffer = []; //reset the buffer
    db.ref(`doors/Door${doorNumber}`).set(false); // Update the door open/close status in Firebase
    updateMainMsg(`Door ${doorNumber} (Dock ${dockNumber}) opened.`); // Update main message in Firebase
    rpio.write(RED_LIGHT, 0);
    rpio.write(GREEN_LIGHT, 1);
    doorOpenTime = Date.now();
    // Start the ultrasonic sensor after a 3-second delay
    setTimeout(() => {
      // Trigger ultrasonic distance measurements every 500 milliseconds
      intervalId = setInterval(() => {
        trigger.trigger(10, 1); // Set trigger high for 10 microseconds
      }, 500);
    }, 3000);
    if (doorCloseTime !== null) {
      lastTurnaroundTime = (doorOpenTime - doorCloseTime) / 1000;
      if (lastTurnaroundTime < 20 * 60) {
        console.log(
          `Turnaround time: ${lastTurnaroundTime.toFixed(2)} seconds.`
        );
        const minutes = Math.floor(lastTurnaroundTime / 60);
        const seconds = Math.floor(lastTurnaroundTime % 60);
        const message = `${minutes} min. ${seconds} secs.`;
      }
    }
  } else if (isOpen !== oldIsOpen) {
    console.log("PlaneMate Door CLOSED"); // door has been detected to be closed

    clearInterval(intervalId); // Stop the interval
    db.ref(`doors/Door${doorNumber}`).set(true); // Update the door status in Firebase
    updateMainMsg(`Door ${doorNumber} (Dock ${dockNumber}) closed.`); // Update main message in Firebase
    rpio.write(GREEN_LIGHT, 0);
    rpio.write(RED_LIGHT, 1);

    doorCloseTime = Date.now();

    const doorOpenDuration = (doorCloseTime - doorOpenTime) / 1000;
    const openTimestamp = new Date(doorOpenTime).toISOString();
    const firstPassengerTimestamp = new Date(firstPassengerTime).toISOString();
    // const lastPassengerTimetamp = new Date(secondLastPassengerTime).toISOString();
    const lastPassengerTimetamp = timestampBuffer[timestampBuffer.length - 1];
    const closeTimestamp = new Date(doorCloseTime).toISOString();
    const boardingDuration =
      (doorCloseTime - timestampBuffer[timestampBuffer.length - 1]) / 1000;

    log("boardingDuration: " + boardingDuration);
    log("Total People Detected: " + peopleCount);

    if (doorOpenDuration > 10) {
      const fields = {
        "Door Open": openTimestamp,
        "Door Close": closeTimestamp,
        "Door Open Duration": doorOpenDuration,
        "Passengers Counted": peopleCount - 1,
        "Boarding Start": firstPassengerTimestamp,
        "Boarding Stop": lastPassengerTimetamp,
        boardingDuration: boardingDuration,
      };

      if (lastTurnaroundTime !== null && lastTurnaroundTime < 20 * 60) {
        fields["Turnaround Time"] = lastTurnaroundTime;
      }

      addAirtableRecord(fields).then(() => {
        log("AirTable record added");
      });

      // Update the latest action stats in Firebase
      db.ref(`lastTransaction/openTimestamp`).set(openTimestamp);
      db.ref(`lastTransaction/closeTimestamp`).set(closeTimestamp);
      db.ref(`lastTransaction/doorOpenDuration`).set(doorOpenDuration);
      db.ref(`lastTransaction/peopleCount`).set(peopleCount - 1);
      db.ref(`lastTransaction/firstPassengerTimestamp`).set(
        firstPassengerTimestamp
      );
      db.ref(`lastTransaction/lastPassengerTimestamp`).set(
        lastPassengerTimetamp
      );
      db.ref(`lastTransaction/boardingDuration`).set(boardingDuration);
    }
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

// primary function that runs when the program starts
async function main() {
  await getDoorAssignment();
  turnOffAllLights();
  await waitForDoorToClose();
  pollSensor();
}

// run the main function
main();
