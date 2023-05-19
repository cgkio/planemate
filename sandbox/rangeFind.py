#!/usr/bin/python3
# Filename: rangeFind.py

# Reads serial data from Maxbotix ultrasonic rangefinders and detects people passing through a door with a 2-foot safety margin

from time import sleep, time
from serial import Serial

# MaxSonarTTY configuration
serialDevice = "/dev/ttyAMA0" # default for RaspberryPi
maxwait = 3 # seconds to try for a good reading before quitting

def measure(portName):
    ser = Serial(portName, 9600, 8, 'N', 1, timeout=1)
    timeStart = time()
    valueCount = 0

    while time() < timeStart + maxwait:
        if ser.inWaiting():
            bytesToRead = ser.inWaiting()
            valueCount += 1
            if valueCount < 2: # 1st reading may be partial number; throw it out
                continue
            testData = ser.read(bytesToRead)
            if not testData.startswith(b'R'):
                # data received did not start with R
                continue
            try:
                sensorData = testData.decode('utf-8').lstrip('R')
            except UnicodeDecodeError:
                # data received could not be decoded properly
                continue
            try:
                mm = int(sensorData)
            except ValueError:
                # value is not a number
                continue
            ser.close()
            return(mm)

    ser.close()
    raise RuntimeError("Expected serial data not received")

# rangeFind configuration
serialPort = "/dev/ttyAMA0"
consecutive_readings = 3
sleepTime = 0.1
readings_below_threshold = 0
safety_margin_mm = 2 * 12 * 25.4  # 2 feet in millimeters

# Get initial reading and set it as the threshold
initial_reading = measure(serialPort)
threshold = initial_reading - safety_margin_mm
print(f"Initial distance: {initial_reading} mm")

def mm_to_feet_and_inches(mm):
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = total_inches % 12
    return feet, inches

while True:
    mm = measure(serialPort)
    if mm < threshold:
        readings_below_threshold += 1
        if readings_below_threshold >= consecutive_readings:
            height_mm = initial_reading - mm
            feet, inches = mm_to_feet_and_inches(height_mm)
            # Print a JSON string with the detected person's height
            print(f'{{"event": "person_detected", "height_feet": {feet}, "height_inches": {inches:.1f}}}')
            readings_below_threshold = 0
            sleep(1)  # Wait for a short period before resuming detection to avoid multiple triggers for the same person
    else:
        readings_below_threshold = 0

    sleep(sleepTime)



    