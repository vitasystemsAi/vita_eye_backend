'use strict';

/** Plug-in LAN-port cameras that are found automatically, separate from typed LAN IP cameras. */
const NEXT = "ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN', 'LAN_PORT')";
const PREVIOUS = "ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN')";

async function up({ context: { queryInterface } }) {
  await queryInterface.sequelize.query(`ALTER TABLE cameras MODIFY camera_type ${NEXT} NOT NULL`);
}

async function down({ context: { queryInterface } }) {
  await queryInterface.sequelize.query("UPDATE cameras SET camera_type = 'LAN' WHERE camera_type = 'LAN_PORT'");
  await queryInterface.sequelize.query(`ALTER TABLE cameras MODIFY camera_type ${PREVIOUS} NOT NULL`);
}

module.exports = { up, down };
