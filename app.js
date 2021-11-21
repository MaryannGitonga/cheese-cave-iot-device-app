// Cheese Cave device app

require('dotenv').config();
'use strict';
const chalk = require('chalk');
console.log(chalk.yellow('Cheese cave device app'));

// The device connection string to authenticate the device with the IoT hub.
const connectionString = process.env.DEVICE_CONNECTION_STRING;

// The sample connects to a device-specific MQTT endpoint on the IoT hub.
const Mqtt = require('azure-iot-device-mqtt').Mqtt;
const DeviceClient = require('azure-iot-device').Client;
const Message = require('azure-iot-device').Message;

const client = DeviceClient.fromConnectionString(connectionString, Mqtt);

// Global Variables.
const ambientTemperature = 70;                      // Ambient temperature of a southern cave, in degrees F.
const ambientHumidity = 99;                         // Ambient humdity in relative percentage of air saturation.
let desiredTemperature = ambientTemperature-10;     // Initial desired temperature, in degrees F.
const desiredTempLimit = 5;                         // Acceptable range above or below the desired temp, in degrees F.
let desiredHumidity = ambientHumidity - 20;         // Initial desired humidity in relative percentage or air saturation.
const desiredHumidityLimit = 10;                    // Acceptable range above or below the dsired humidity, in percentages.
const intervalInMilliseconds = 5000;                // Interval at which telemetry is sent to the cloud.

// Enum for the state of the fan for the cooling/heating, and humidifying/de-humidifying.
const stateEnum = Object.freeze({ "off": "off", "on": "on", "failed": "failed" });
let fanState = stateEnum.off;

let currentTemperature = ambientTemperature;
let currentHumidity = ambientHumidity;

function greenMessage(text){
    console.log(chalk.green(text));
}

function redMessage(text){
    console.log(chalk.red(text));
}

// Send telemetry messages to the hub.
function sendMessage() {
    let deltaTemperature = Math.sign(desiredTemperature - currentTemperature);
    let deltaHumidity = Math.sign(desiredHumidity - currentHumidity);

    if (fanState == stateEnum.on){
        // If the fan is on, the temperature and humidity will be nudged towards the desired values most of the time.
        currentTemperature += (deltaTemperature * Math.random()) + Math.random() - 0.5;
        currentHumidity += (deltaHumidity * Math.random()) + Math.random() - 0.5;

        // Randomly fail the fan
        if (Math.random() < 0.01){
            fanState = stateEnum.failed;
            redMessage('Fan has failed');
        }
    }
    else {
        // If the fan is off, or has failed, the temperature and humidity will creep up until they reach the ambient value, thereafter fluctuate randomly.
        if (currentTemperature < ambientTemperature){
            currentTemperature += Math.random() / 10;
        }else {
            currentTemperature += Math.random() - 0.5;
        }
        if (currentHumidity < ambientHumidity - 1) {
            currentHumidity += Math.random() / 10;
        }else{
            currentHumidity += Math.random() - 0.5;
        }
    }

    // Check: humidity can never exceed 100%.
    currentHumidity = Math.min(100, currentHumidity);

    // Prepare the telemetry message.
    const message = new Message(JSON.stringify({
        temperature: currentTemperature.toFixed(2),
        humidity: currentHumidity.toFixed(2),
    }));

    // Add custom application properties to the message.
    // An IoT hub can filter on these properties without access to the message body.
    message.properties.add('sensorID', "S1");
    message.properties.add('fanAlert', (fanState == stateEnum.failed) ? 'true': 'false');

    // Send temperature or humidity alerts, only if they occur.
    if ((currentTemperature > desiredTemperature + desiredTempLimit) || (currentTemperature < desiredTemperature - desiredTempLimit)){
        message.properties.add('temperatureAlert', 'true');
    }

    if ((currentHumidity > desiredHumidity + desiredHumidityLimit) || (currentHumidity < desiredHumidity - desiredHumidityLimit)) {
        message.properties.add('humidityAlert', 'true');
    }

    console.log('\nMessage data: ' + message.getData());

    // Send the telemetry message.
    client.sendEvent(message, function (err) {
        if (err) {
            redMessage('Send error: ' + err.toString());
        } else {
            greenMessage('Message sent');
        }
    });
}

// Set up the telemetry interval
setInterval(sendMessage, intervalInMilliseconds)

// Function to handle the SetFanState direct method call from IoT hub.
function onSetFanState(request, reponse) {
    // Function to send a direct method response to the IoT hub.
    function directMethodResponse(err) {
        if (err) {
            redMessage('An error ocurred when sending a method response: \n' + err.toString());
        } else {
            greenMessage('Response to method \'' + request.methodName + '\' sent successfully. ');
        }
    }
    greenMessage('Direct method payload received:' + request.payload);

    // Check that a valid value was passed as a parameter.
    if (fanState == stateEnum.failed) {
        redMessage('Fan has failed and cannot have its state changed.');
    } else {
        if (request.payload != "on" && request.payload != "off") {
            redMessage('Invalid state response received in payload.');

            // Report payload failure back to the hub.
            reponse.send(400, 'Invalid direct method parameter: ' +  request.payload, directMethodResponse);
        } else {
            fanState = request.payload;

            // Reposrt success back to the hub.
            reponse.send(200, 'Fan state set: ' + request.payload, directMethodResponse);
        }
    }
}

// Set up the handler for the SetFanState direct method call.
client.onDeviceMethod('SetFanState', onSetFanState);