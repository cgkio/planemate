var Gpio = require('pigpio').Gpio;

// Define the GPIO pin that you've connected to the sensor
var sensorPinNo1 = 18; // change this to the pin you are using
var sensorPinNo2 = 23; // change this to the pin you are using
var sensorPinNo3 = 24; // change this to the pin you are using
var sensorPinNo4 = 25; // change this to the pin you are using

// Create new Gpio objects for the sensors
var sensor1 = new Gpio(sensorPinNo1, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE
});

var sensor2 = new Gpio(sensorPinNo2, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE
});

var sensor3 = new Gpio(sensorPinNo3, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE
});

var sensor4 = new Gpio(sensorPinNo4, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PUD_UP,
  edge: Gpio.EITHER_EDGE
});

// Create a function that can be used for all sensors
function handleInterrupt(sensor, previousState) {
  var debounceTimeout = null;

  sensor.on('interrupt', function (level) {
    if(debounceTimeout) clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(function() {
      if (level !== previousState) {
        console.log(`Sensor on pin ${sensor.gpio} changed: ${level === 0 ? 'Door is open' : 'Door is closed'}`);
        previousState = level;
      }
    }, 100); // 100 ms debounce period
  });
}

// Handle interrupts for all sensors
handleInterrupt(sensor1, sensor1.digitalRead());
handleInterrupt(sensor2, sensor2.digitalRead());
handleInterrupt(sensor3, sensor3.digitalRead());
handleInterrupt(sensor4, sensor4.digitalRead());

// Keep the script running
setInterval(function(){}, 1000);
