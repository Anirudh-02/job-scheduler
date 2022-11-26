const Sequelize = require('sequelize')
const dotenv = require('dotenv').config()

const db = new Sequelize(process.env.MYSQL_URL || 'mysql://root@127.0.0.1:4000/test', {
    logging: false
})

const Tasks = db.define('tasks', {
    id: {
        type: Sequelize.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
    },
    priority: {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: false
    },
    time_stamp: {
        type: Sequelize.DataTypes.BIGINT,
        allowNull: false
    },
    dependency: {
        type: Sequelize.DataTypes.INTEGER
    },
    type: {
        type: Sequelize.DataTypes.STRING,
    }
})

module.exports = { Tasks, db }