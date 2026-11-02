'use strict';

/** USB/USB-C cable cameras and direct LAN-port cameras. */
const WITH_DIRECT = "ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN')";
const ORIGINAL = "ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG')";

async function up({ context: { queryInterface } }) {
  await queryInterface.sequelize.query(`ALTER TABLE cameras MODIFY camera_type ${WITH_DIRECT} NOT NULL`);
}

async function down({ context: { queryInterface } }) {
  await queryInterface.sequelize.query("UPDATE cameras SET camera_type = 'BROWSER' WHERE camera_type = 'USB'");
  await queryInterface.sequelize.query(
    "UPDATE cameras SET camera_type = 'HTTP_MJPEG' WHERE camera_type = 'LAN' AND stream_reference LIKE 'http%'",
  );
  await queryInterface.sequelize.query("UPDATE cameras SET camera_type = 'RTSP' WHERE camera_type = 'LAN'");
  await queryInterface.sequelize.query(`ALTER TABLE cameras MODIFY camera_type ${ORIGINAL} NOT NULL`);
}

module.exports = { up, down };
