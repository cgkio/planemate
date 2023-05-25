# PlaneMate Turnaround Analysis Sensor - Prototype

Headless Raspberry Pi running Node.js that autoboots.

### Features:
- AirTable database logging
- Calculates boarding duration
- Calculates turnaround time
- Ability to remotely assign Pis to specific dock and door #
- Real-time red light / green light visual dashboard
- Runs script on boot with sudo permissions
- Counts passengers when the loading starts
- Dashboard to show "real time" test data
- 3 second delay on people counting when the door opens
- Live count of passengers on dashboard
- Remote reboot via PiTunnel
- Determines/estimtes if the PlaneMate arrived after the flight arrived
- Script automatically runs on bootup and crashes (PM2)

### Next Up
- Add a 3 second "delay" on people counting when the door closes (seperate variable)

### Features Pending

- Document permission settings commands for setting up a Raspberry Pi
- Report error is door open times exceed XXX
- Crash reporting via PM2 reboot

### Instructions:

**To SSH:**
```
ssh stratops@stratopspi.local
 
username: stratops
password: M******7!
```

**To create repo on Pi:**
```
$ gh repo clone cgkio/planemate
```

**To update repo on Pi:**
```
$ cd planemate
$ gh repo sync
```

**To stash/revert back on Pi:**
```
$ cd planemate
$ git reset --hard
```

**To remove repo folder:**
```
$ cd ..
$ sudo rm -rf planemate/
```

**To start application:**
```
$ sudo node app.js
```

**To stop applicaton:**
`Control + Z`

**To reboot:**
```
$ sudo reboot
```

**To establish sudo permissions and auto-start on boot:**

Create a new file for the systemd service:
```
sudo nano /etc/systemd/system/my-nodejs-app.service
```

In the opened file, paste the following content:
```
[Unit]
Description=planemateapp
After=network.target

[Service]
User=root
WorkingDirectory=/home/stratops/planemate
ExecStart=/usr/bin/node /home/stratops/planemate/app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Save the file and exit the editor (press CTRL + X, then Y, and then Enter).

Reload the systemd configuration:
```
sudo systemctl daemon-reload
```

Enable and start the service:
```
sudo systemctl enable my-nodejs-app.service
sudo systemctl start my-nodejs-app.service
```

**To check the status of the service:**
```
sudo systemctl status my-nodejs-app.service
```

**To stop or restart the service:**
```
sudo systemctl stop my-nodejs-app.service
sudo systemctl restart my-nodejs-app.service
```

**To turn off the auto-reload:**
```
sudo systemctl disable my-nodejs-app.service
src: https://nodesource.com/blog/running-your-node-js-app-with-systemd-part-1/
```

**PM2 Node App Manager**

https://pm2.keymetrics.io/docs/usage/quick-start/

To make PM2 start on boot:
```
pm2 startup
This will output a command that you need to run.
```

Start your PM2 auto-application:
```
sudo su // switch to the root user
pm2 start /home/stratops/planemate/app.js //PM2 will automatically restart your application if it crashes.
pm2 save // This makes PM2 restart app on boot
```

Remember, if you make changes to your Node.js application, you'll need to either restart the Raspberry Pi or use ```pm2 reload``` to ensure the changes take effect.

See PM2 status:
```
pm2 list
```

See PM2 logs:
```
pm2 log
```

Stop PM2 (for manual operations):
```
pm2 kill
or
pm2 stop all (keeps PM2 running)
```
