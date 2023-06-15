var Gpio = require('pigpio').Gpio;

// Define the GPIO pin that you've connected to the sensor
var sensorPinNo1 = 18;
var sensorPinNo2 = 24;
var sensorPinNo3 = 1;
var sensorPinNo4 = 12;

var sensor1Name = "Door One";
var sensor2Name = "Door Two";
var sensor3Name = "Door Three";
var sensor4Name = "Door Four";

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
function handleInterrupt(sensor, sensorName, previousState) {
  var debounceTimeout = null;

  sensor.on('interrupt', function (level) {
    if(debounceTimeout) clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(function() {
      if (level !== previousState) {
        console.log(`${sensorName} - ${level === 0 ? 'Open' : 'Closed'}`);
        previousState = level;
      }
    }, 100); // 100 ms debounce period
  });
}

// Handle interrupts for all sensors
handleInterrupt(sensor1, sensor1Name, sensor1.digitalRead());
console.log(`${sensor1Name} - ${sensor1.digitalRead() === 0 ? 'Open' : 'Closed'}`);

handleInterrupt(sensor2, sensor2Name, sensor2.digitalRead());
console.log(`${sensor2Name} - ${sensor2.digitalRead() === 0 ? 'Open' : 'Closed'}`);

handleInterrupt(sensor3, sensor3Name, sensor3.digitalRead());
console.log(`${sensor3Name} - ${sensor3.digitalRead() === 0 ? 'Open' : 'Closed'}`);

handleInterrupt(sensor4, sensor4Name, sensor4.digitalRead());
console.log(`${sensor4Name} - ${sensor4.digitalRead() === 0 ? 'Open' : 'Closed'}`);

// Keep the script running
setInterval(function(){}, 1000);
