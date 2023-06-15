const rpio = require("rpio");
const axios = require("axios");
const macaddress = require("macaddress");
const firebaseAdmin = require("firebase-admin");
const moment = require("moment");
const Gpio = require("pigpio").Gpio;
const Airtable = require("airtable");

let doLogStuff = true;
let isOpen = null;
let oldIsOpen = null;
let timestampBuffer = [];

rpio.init({
  gpiomem: true,
});

// Raspberry Pi 4 pin assignments
const DOOR_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
// const DOOR_2_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
// const DOOR_3_SENSOR_PIN = 12; // magnetic contact switch (door sensor)
// const DOOR_4_SENSOR_PIN = 12; // magnetic contact switch (door sensor)

// Initialize the GPIO pins
rpio.init({ gpiomem: false });
rpio.open(DOOR_SENSOR_PIN, rpio.INPUT, rpio.PULL_UP);
// rpio.open(DOOR_SENSOR_PIN, rpio.INPUT, rpio.PULL_DOWN);

// functions to handle debugging logs
function log(message) {
  if (doLogStuff === true) {
    console.log(message);
  }
}

// function that polls the door sensor every 100 milliseconds for open/close status
function pollSensor() {
    oldIsOpen = isOpen;
    isOpen = rpio.read(DOOR_SENSOR_PIN);
    console.log(isOpen);
    if (!isOpen && isOpen !== oldIsOpen) {
      log("Door One - OPEN"); // door has been detected to be open
      timestampBuffer.push(Date.now()); // add first timestamp to the buffer for when the door opened
    } else if (isOpen !== oldIsOpen) {
      log("Door One - CLOSED"); // door has been detected to be closed
      timestampBuffer.push(Date.now()); // add the current timestamp to the buffer as the door closed time
      // const openTimestamp = new Date(timestampBuffer[0]).toISOString();
      // const closeTimestamp = new Date(timestampBuffer[1]).toISOString();
      // const boardingDuration = (lastPassengerTimestamp - firstPassengerTime) / 1000;
      // log(timestampBuffer)
      // log(openTimestamp);
      // log(closeTimestamp);
      // log(boardingDuration);
    }
    setTimeout(pollSensor, 1000);
  }

pollSensor();