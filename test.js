var Gpio = require('pigpio').Gpio;

// Define the GPIO pin that you've connected to the sensor
var sensorPinNo = 18; // change this to the pin you are using

// Create a new Gpio object for the sensor
var sensor = new Gpio(sensorPinNo, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP, // Set the internal pull-up resistor
  edge: Gpio.EITHER_EDGE // Detect both rising and falling edges
});

// Variable to hold the previous state
var previousState = sensor.digitalRead();

// Report the initial state
console.log(previousState === 0 ? "Door is open" : "Door is closed");

// Detect door open or close based on the GPIO pin state
sensor.on('interrupt', function(level) {
  if (level !== previousState) { // Only report changes
    if (level === 0) { // Falling edge means door open for NC sensor
      console.log("Door is open");
    } else { // Rising edge means door closed for NC sensor
      console.log("Door is closed");
    }
    previousState = level; // Store the new state
  }
});

// Keep the script running
setInterval(function(){}, 500);
