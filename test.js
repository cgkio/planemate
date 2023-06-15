var Gpio = require('pigpio').Gpio;

// Define the GPIO pin that you've connected to the NO point on the sensor
var sensorPinNo = 18; // change this to the pin you are using

// Create a new Gpio object for the sensor
var sensor = new Gpio(sensorPinNo, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP, // Set the internal pull-up resistor
  edge: Gpio.EITHER_EDGE // Detect both rising and falling edges
});

// Detect door open or close based on the GPIO pin state
sensor.on('interrupt', function(level) {
  if (level === 0) { // Falling edge means door closed
    console.log("Door is closed");
  } else { // Rising edge means door open
    console.log("Door is open");
  }
});
