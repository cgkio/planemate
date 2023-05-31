// A Raspberry Pi 4 is used to monitor PlaneMates, a type of transportation at Washington Dulles International Airport.
// Passengers board PlaneMates when a flight departs. When one PlaneMate is full, the entry door closes, the PlaneMate departs, another PlaneMate arrives, and the entry door reopens to allow people to board the PlaneMate.
// The Raspberry Pi will be mounted to the door, with the contact switch monitoring the opening and shutting of the door and the ultrasonic sensor counting passengers as they pass through.

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
let doorCloseTime = null;
let lastTurnaroundTime = null;
let intervalId;
let timestampBuffer = [];
let doorCycleCount = 0;
let planeMateOnTime = false; // Set to false by default
const lastPassengerTimestamp = null;

// Global variables for configuring algorithms
let baselineDetectedPulses; // Number of consecutive pulses to detect a baseline
let baselineVarianceLimit; // Number of centimeters to allow for variance from the baseline
let boardingStartPersons; // Number of people to detect before recognizing boarding has started
let boardingStartTimeWindow; // Number of milliseconds to wait before recognizing boarding has started if boardingStartPersons has been detected
let initialDoorOpenDelay; // Number of milliseconds to wait before turning on the ultrasonic sensor
let personDetectedPulses; // Number of consecutive pulses to detect a person
let turnaroundReset; // Number of minutes to wait before resetting PlaneMate operations (for turnaround time calculations)
let doorCycleTrigger; // Number of door open/close cycles before recaluclating KPIs

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

// Add a new variable to track consecutive baselines
let consecutiveBaselines = 0;

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
      if (
        !personDetected &&
        Math.abs(distance - baseline) > baselineVarianceLimit
      ) {
        consecutiveDetections++;

        if (consecutiveDetections >= personDetectedPulses) {
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
            timestampBuffer.length >= boardingStartPersons &&
            timestampBuffer[timestampBuffer.length - 1] - timestampBuffer[0] <=
              boardingStartTimeWindow
          ) {
            if (!firstPassengerTime) {
              firstPassengerTime = timestampBuffer[0]; //set the boarding started timestamp to the first person in the flow
              db.ref(`lastTransaction/firstPassengerTimestamp`).set(
                moment(firstPassengerTime).format("LTS")
              ); // update the first passenger timestamp in Firebase for display on the dashboard
              log("Boarding time started at: " + firstPassengerTime);
              log(
                "Boarding time started at: " +
                  new Date(firstPassengerTime).toISOString()
              );
              log(
                "Boarding time started at: " +
                  moment(firstPassengerTime).format("YYYY-MM-DD HH:mm:ss")
              );
            }
          }
        }
      } else if (personDetected && Math.abs(distance - baseline) <= 30) {
        consecutiveBaselines++;
        if (consecutiveBaselines >= 3) {
          personDetected = false;
          log("3 baseline measurements detected - Person has passed");
          consecutiveBaselines = 0;
        }
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
  }, 200);
}

// This function flashes all the lights and restores the original state
async function flashAllLights() {
  // Save the current state of the lights
  let redLightState = rpio.read(RED_LIGHT);
  let yellowLightState = rpio.read(YELLOW_LIGHT);
  let greenLightState = rpio.read(GREEN_LIGHT);

  // Turn on all the lights
  rpio.write(RED_LIGHT, 1);
  rpio.write(YELLOW_LIGHT, 1);
  rpio.write(GREEN_LIGHT, 1);

  // Wait for a moment
  await sleep(1000); // sleep function can be implemented as: function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // Turn off all the lights
  rpio.write(RED_LIGHT, 0);
  rpio.write(YELLOW_LIGHT, 0);
  rpio.write(GREEN_LIGHT, 0);

  // Restore the original state of the lights
  rpio.write(RED_LIGHT, redLightState);
  rpio.write(YELLOW_LIGHT, yellowLightState);
  rpio.write(GREEN_LIGHT, greenLightState);
}

// utility function to pause the program for a specified number of milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function switchLightOn(light) {
  // First turn off all lights
  rpio.write(RED_LIGHT, 0);
  rpio.write(YELLOW_LIGHT, 0);
  rpio.write(GREEN_LIGHT, 0);

  // Then turn the specific light on
  rpio.write(light, 1);
}

async function lightsShow() {
  let endTime = Date.now() + 3000; // 3 seconds from now

  while (Date.now() < endTime) {
    switchLightOn(GREEN_LIGHT);
    await sleep(250); // wait for 250 milliseconds
    switchLightOn(YELLOW_LIGHT);
    await sleep(250);
    switchLightOn(RED_LIGHT);
    await sleep(250);
    switchLightOn(YELLOW_LIGHT);
    await sleep(250);
  }

  // Turn off all lights at the end of the light show
  rpio.write(RED_LIGHT, 0);
  rpio.write(YELLOW_LIGHT, 0);
  rpio.write(GREEN_LIGHT, 0);
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
    db.ref("lastTransaction/activePassengerCount").set(0); // reset the active passenger count in Firebase for display on the dashboard
    db.ref(`lastTransaction/location`).set(
      "Door " + doorNumber + " | Dock " + dockNumber
    ); // update the location in Firebase for display on the dashboard
    timestampBuffer = []; //reset the buffer
    db.ref(`doors/Door${doorNumber}`).set(false); // Update the door open/close status in Firebase
    updateMainMsg(`Door ${doorNumber} (Dock ${dockNumber}) opened.`); // Update main message in Firebase
    rpio.write(RED_LIGHT, 0);
    rpio.write(GREEN_LIGHT, 1);
    setTimeout(async function () {
      // Wait for 10 seconds before flashing the lights to signify that we've passed the 10-second mark
      await flashAllLights();
    }, 10000); // 10000 milliseconds = 10 seconds
    doorOpenTime = Date.now();
    db.ref(`lastTransaction/openTimestamp`).set(moment().format("LTS")); // update the door open time in Firebase for display on the dashboard
    db.ref(`lastTransaction/closeTimestamp`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/boardingDuration`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/planeMateOnTime`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/firstPassengerTimestamp`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/lastPassengerTimestamp`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/doorOpenDuration`).set("_______"); // update for display on the dashboard
    db.ref(`lastTransaction/turnaroundTime`).set("_______"); // update for display on the dashboard
    // Start the ultrasonic sensor after a 3-second delay
    setTimeout(() => {
      log("Starting ultrasonic sensor");
      flashAllLights();
      // Trigger ultrasonic distance measurements every 500 milliseconds
      intervalId = setInterval(() => {
        trigger.trigger(10, 1); // Set trigger high for 10 microseconds
      }, 250);
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
    db.ref("lastTransaction/activePassengerCount").set(peopleCount - 1); // update the active passenger count in Firebase
    doorCycleCount++; // increment the door cycle count
    clearInterval(intervalId); // Stop the interval
    db.ref(`doors/Door${doorNumber}`).set(true); // Update the door status in Firebase
    updateMainMsg(`Door ${doorNumber} (Dock ${dockNumber}) closed.`); // Update main message in Firebase
    rpio.write(GREEN_LIGHT, 0);
    rpio.write(RED_LIGHT, 1);

    doorCloseTime = Date.now();

    const doorOpenDuration = (doorCloseTime - doorOpenTime) / 1000;
    const openTimestamp = new Date(doorOpenTime).toISOString();
    const firstPassengerTimestamp = new Date(firstPassengerTime).toISOString();
    // const lastPassengerTimestamp = new Date(
    //   timestampBuffer[timestampBuffer.length - 2]
    // ).toISOString();

    log(timestampBuffer);
    log("timestampBuffer.length: " + timestampBuffer.length);

    if (timestampBuffer.length > 2) {
      const lastPassengerTimestamp = new Date(
        timestampBuffer[timestampBuffer.length - 2]
      ).toISOString();
    } else if (timestampBuffer.length === 0) {
      const lastPassengerTimestamp = null;
    } else {
      const lastPassengerTimestamp =
        timestampBuffer[timestampBuffer.length - 1].toISOString();
    }

    log("lastPassengerTimestamp: " + lastPassengerTimestamp);

    const closeTimestamp = new Date(doorCloseTime).toISOString();
    const boardingDuration =
      (timestampBuffer[timestampBuffer.length - 2] - firstPassengerTime) / 1000;

    log("boardingDuration: " + boardingDuration);
    log("Total People Detected: " + peopleCount);

    log("firstPassengerTime: " + firstPassengerTime);
    log("doorOpenTime: " + doorOpenTime);
    log("lastTurnaroundTime: " + lastTurnaroundTime);

    if (
      firstPassengerTime - doorOpenTime > 30000 &&
      lastTurnaroundTime > turnaroundReset * 60 || lastTurnaroundTime === null
    ) {
      planeMateOnTime = "Yes";
    } else if (
      firstPassengerTime - doorOpenTime <= 30000 &&
      lastTurnaroundTime >= turnaroundReset * 60 || lastTurnaroundTime === null
    ) {
      planeMateOnTime = "No";
    } else {
      planeMateOnTime = "N/A";
    }

    log("planeMateOnTime: " + planeMateOnTime);

    db.ref(`lastTransaction/planeMateOnTime`).set(planeMateOnTime);

    if (doorOpenDuration > 10) {
      // Only process a record if the door was open for more than 10 seconds
      const fields = {
        "Door Open": openTimestamp,
        "Door Close": closeTimestamp,
        "Door Open Duration": doorOpenDuration,
        "Passengers Counted": peopleCount - 1,
        "Boarding Start": firstPassengerTimestamp,
        "Boarding Stop": lastPassengerTimestamp,
        boardingDuration: boardingDuration,
        "PlaneMate On-Time": planeMateOnTime,
      };

      if (lastTurnaroundTime !== null && lastTurnaroundTime < 20 * 60) {
        fields["Turnaround Time"] = lastTurnaroundTime;
        db.ref(`lastTransaction/turnaroundTime`).set(lastTurnaroundTime);
      }

      addAirtableRecord(fields).then(() => {
        log("AirTable record added");
      });

      firstPassengerTime = null;

      // Update the latest action stats in Firebase
      db.ref(`lastTransaction/closeTimestamp`).set(
        moment(closeTimestamp).format("LTS")
      );
      db.ref(`lastTransaction/doorOpenDuration`).set(
        doorOpenDuration + " seconds"
      );
      db.ref(`lastTransaction/peopleCount`).set(peopleCount - 1);
      // db.ref(`lastTransaction/firstPassengerTimestamp`).set(
      //   firstPassengerTimestamp
      // );
      db.ref(`lastTransaction/lastPassengerTimestamp`).set(
        lastPassengerTimestamp
      );
      db.ref(`lastTransaction/boardingDuration`).set(
        boardingDuration + " seconds"
      );

      // Update the KPIs in Firebase every X door cycles
      if (doorCycleCount >= doorCycleTrigger) {
        doorCycleCount = 0;
        (async () => {
          await storeData(
            "stats/AverageBoardingTime",
            "boardingDuration",
            true,
            false
          );
          await storeData(
            "stats/AverageLoad",
            "Passengers Counted",
            false,
            false
          );
          await storeData(
            "stats/planeMateOnTime",
            "PlaneMate On-Time",
            false,
            true
          );
          await storeData(
            "stats/AverageTurnaroundTimeOverall",
            "Turnaround Time",
            true,
            false
          );
          log("KPIs updated");
        })();
      }
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
  turnOffAllLights();
  await getDoorAssignment();
  await lightsShow();
  await waitForDoorToClose();
  pollSensor();
}

// Fetch global variables from Firebase
db.ref("variables")
  .once("value")
  .then((snapshot) => {
    const data = snapshot.val();
    baselineDetectedPulses = data.baselineDetectedPulses;
    baselineVarianceLimit = data.baselineVariance;
    boardingStartPersons = data.boardingStartPersons;
    boardingStartTimeWindow = data.boardingStartTimeWindow;
    initialDoorOpenDelay = data.initialDoorOpenDelay;
    personDetectedPulses = data.personDetectedPulses;
    turnaroundReset = data.turnaroundReset;
    KPIrecalulation = data.KPIrecalulation;

    // Console log the new values
    console.log("New values fetched from Firebase:");
    console.log("baselineDetectedPulses:", baselineDetectedPulses);
    console.log("baselineVarianceLimit:", baselineVarianceLimit);
    console.log("boardingStartPersons:", boardingStartPersons);
    console.log("boardingStartTimeWindow:", boardingStartTimeWindow);
    console.log("initialDoorOpenDelay:", initialDoorOpenDelay);
    console.log("personDetectedPulses:", personDetectedPulses);
    console.log("turnaroundReset:", turnaroundReset);
    console.log("KPIrecalulation:", KPIrecalulation);

    // Call the main function
    main();
  })
  .catch((error) => {
    console.error("Error reading Firebase data: ", error);
  });
