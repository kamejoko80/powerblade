#!/usr/bin/env node

// imports
var noble = require('noble');
var fs = require('fs');

// input from user
var target_device = 'c0:98:e5:70:45:36';
var wattage = 200;
var voltage = 120;
if (process.argv.length >= 5) {
    target_device = process.argv[2];
    wattage = process.argv[3];
    voltage = process.argv[4];
} else {
    console.log("Missing arguments: ");
    console.log("Expected: address wattage voltage [display config]");
    console.log("Ex: ./calibrate.js c0:98:e5:70:00:01 200.0 120.0 --read");
    process.exit(1);
}
var read_config = false;
if (process.argv.length >= 6) {
    if (process.argv[5] == '--read') {
        read_config = true;
    }
}
console.log("Looking for " + target_device);
console.log("Calibrating at " + wattage + " W and " + voltage + " V");

// reference to discovered peripheral
var powerblade_periph;

// internal calibration service
var calibration_service_uuid = '57c4ed0b9461d99e844ed5aa70304b49';
var calibration_wattage_uuid = '57c4ed0c9461d99e844ed5aa70304b49';
var calibration_voltage_uuid = '57c4ed0d9461d99e844ed5aa70304b49';
var calibration_control_uuid = '57c4ed0e9461d99e844ed5aa70304b49';
var calibration_wattage_char;
var calibration_voltage_char;
var calibration_control_char;

/*XXX REMOVE
// raw sample collection service
var rawSample_service_uuid = 'cead01af7cf8cc8c1c4e882a39d41531';
var rawSample_start_uuid   = 'cead01b07cf8cc8c1c4e882a39d41531';
var rawSample_data_uuid    = 'cead01b17cf8cc8c1c4e882a39d41531';
var rawSample_status_uuid  = 'cead01b27cf8cc8c1c4e882a39d41531';
var rawSample_start_char;
var rawSample_data_char;
var rawSample_status_char;
var sampleData = new Buffer(0);
*/

// device configuration service
var config_service_uuid = '50804da1b988f888ec43b957e5acf999';
var config_status_uuid  = '50804da2b988f888ec43b957e5acf999';
var config_voff_uuid    = '50804da3b988f888ec43b957e5acf999';
var config_ioff_uuid    = '50804da4b988f888ec43b957e5acf999';
var config_curoff_uuid  = '50804da5b988f888ec43b957e5acf999';
var config_pscale_uuid  = '50804da6b988f888ec43b957e5acf999';
var config_vscale_uuid  = '50804da7b988f888ec43b957e5acf999';
var config_whscale_uuid = '50804da8b988f888ec43b957e5acf999';
var config_status_char;
var config_voff_char;
var config_ioff_char;
var config_curoff_char;
var config_pscale_char;
var config_vscale_char;
var config_whscale_char;

// start BLE scanning
noble.on('stateChange', function(state) {
    if (state === 'poweredOn') {
        console.log("Starting scan...\n");
        noble.startScanning([], true);
    } else {
        noble.stopScanning();
    }
});

// exit when disconnected
noble.on('disconnect', function () {
    console.log('Disconnected');
    process.exit(0);
});

// find correct device and connect to it
noble.on('discover', function (peripheral) {
    //console.log(peripheral.address);
    if (peripheral.address == target_device) {
        noble.stopScanning();

        console.log('Found PowerBlade (' + peripheral.address +')\n');
        console.log('Connecting...');
        powerblade_periph = peripheral;
        
        peripheral.connect(function (error) {
            console.log('\tConnected\n');

            // delay before discovering services so that connection
            //  parameters can be established
            setTimeout(discover_calibration, 1000);
        });
    }
});

// print errors if they occur during service/characteristic discovery
function log_discovery_error(desired_char, discovered_list) {
    console.log("Unable to determine correct service/char");
    console.log("Searching for " + desired_char);
    console.log("Service/char List:");
    console.log(discovered_list);
    powerblade_periph.disconnect();
}

// wrapper for discovering a characteristic
function discover_char(service, char_uuid, callback) {
    service.discoverCharacteristics([char_uuid], function(error, chars) {
        if (error) throw error;
        if (chars.length != 1) {
            log_discovery_error(char_uuid, chars);
            return;
        }
        callback(chars[0]);
    });
}

function discover_calibration() {
    console.log("Discovering calibration service");
    powerblade_periph.discoverServices([calibration_service_uuid], function(error, services) {
        if (error) throw error;
        if (services.length != 1) {
            log_discovery_error(calibration_service_uuid, services);
            return;
        }
        var calibration_service = services[0];

        discover_char(calibration_service, calibration_wattage_uuid, function(characteristic) {
            calibration_wattage_char = characteristic;

            discover_char(calibration_service, calibration_voltage_uuid, function(characteristic) {
                calibration_voltage_char = characteristic;

                discover_char(calibration_service, calibration_control_uuid, function(characteristic) {
                    calibration_control_char = characteristic;
                    calibration_control_char.on('data', Calibration_status_receive);
                    calibration_control_char.notify(true);
                    console.log("\tComplete\n");

                    // only bother discovering config service if we need it
                    if (read_config) {
                        discover_config();
                    } else {
                        start_calibration();
                    }
                });
            });
        });
    });
}

function discover_config() {
    console.log("Discovering configuration service");
    powerblade_periph.discoverServices([config_service_uuid], function(error, services) {
        if (error) throw error;
        if (services.length != 1) {
            log_discovery_error(config_service_uuid, services);
            return;
        }
        var config_service = services[0];

        discover_char(config_service, config_status_uuid, function(characteristic) {
            config_status_char = characteristic;
            config_status_char.on('data', Config_status_receive);
            config_status_char.notify(true);

            discover_char(config_service, config_voff_uuid, function(characteristic) {
                config_voff_char = characteristic;

                discover_char(config_service, config_ioff_uuid, function(characteristic) {
                    config_ioff_char = characteristic;

                    discover_char(config_service, config_curoff_uuid, function(characteristic) {
                        config_curoff_char = characteristic;

                        discover_char(config_service, config_pscale_uuid, function(characteristic) {
                            config_pscale_char = characteristic;

                            discover_char(config_service, config_vscale_uuid, function(characteristic) {
                                config_vscale_char = characteristic;

                                discover_char(config_service, config_whscale_uuid, function(characteristic) {
                                    config_whscale_char = characteristic;
                                    console.log("\tComplete\n");

                                    start_calibration();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function Config_status_receive(data, isNotify) {
    if (!isNotify) {
        console.log("Got a non-notification config status?");
    }
    console.log("Received PowerBlade status code:");
    console.log("\t\t" + data[0]);
}

function start_calibration() {
    // everything is read, start calibration
    console.log("Starting calibration");

    // write wattage value
    var buf = new Buffer([0x00, 0x00]);
    buf.writeInt16BE(wattage*10);
    calibration_wattage_char.write(buf, false, function(error) {
        if (error) throw error;
        
        // write voltage value
        buf.writeInt16BE(voltage*10);
        calibration_voltage_char.write(buf, false, function(error) {
            if (error) throw error;

            // begin calibration
            calibration_control_char.write(new Buffer([0x01]), false, function(error) {
                if (error) throw error;
            });
        });
    });
}

function Calibration_status_receive(data, isNotify) {
    if (!isNotify) {
        console.log("Got a non-notificiation calibration status?");
    }

    // check value
    if (data[0] == 1) {
        console.log("Calibrating...");
    } else if (data[0] == 2) {
        console.log("\tComplete\n");

        if (read_config) {
            setTimeout(read_calibration, 1200);
        } else {
            complete_calibration();
        }
    } else {
        console.log("Unknown calibration value: " + data[0]);
    }
}

function complete_calibration() {
    // calibration is complete
    console.log("Calibration Finished!");
    powerblade_periph.disconnect();
    process.exit(0);
}

function read_calibration() {
    console.log("Reading calibration values from PowerBlade...");
    config_voff_char.read(function(error, data) {
        if (error) throw error;
        console.log("Voff= " + data.readInt8() + ' (' + data.toString('hex') + ')');

        config_ioff_char.read(function(error, data) {
            if (error) throw error;
            console.log("Ioff= " + data.readInt8() + ' (' + data.toString('hex') + ')');

            config_curoff_char.read(function(error, data) {
                if (error) throw error;
                console.log("Curoff= " + data.readInt8() + ' (' + data.toString('hex') + ')');

                config_pscale_char.read(function(error, data) {
                    if (error) throw error;
                    console.log("PScale= " + data.readUInt16LE() + ' (' + data.toString('hex') + ')');

                    config_vscale_char.read(function(error, data) {
                        if (error) throw error;
                        console.log("VScale= " + data.readUInt8() + ' (' + data.toString('hex') + ')');

                        config_whscale_char.read(function(error, data) {
                            if (error) throw error;
                            console.log("WHScale= " + data.readUInt8() + ' (' + data.toString('hex') + ')');

                            // writing complete
                            console.log("\tComplete\n");

                            // calibration is complete
                            complete_calibration();
                        });
                    });
                });
            });
        });
    });
}

