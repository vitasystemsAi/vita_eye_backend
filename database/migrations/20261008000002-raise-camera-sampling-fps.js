'use strict';

// At 1 fps a person walking past is only seen in one or two frames; browser cameras are
// self-throttling (one frame in flight), so 8 fps is a safe ceiling.
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.changeColumn('cameras', 'sampling_fps', { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: 8.0 });
  await queryInterface.sequelize.query("UPDATE cameras SET sampling_fps = 8.00 WHERE camera_type = 'BROWSER' AND sampling_fps < 5");
}

async function down({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.changeColumn('cameras', 'sampling_fps', { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: 1.0 });
}

module.exports = { up, down };
