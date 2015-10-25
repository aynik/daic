var mongoose = require('mongoose')
var crypto = require('crypto')
var passportLocalMongoose = require('passport-local-mongoose')

var Schema = mongoose.Schema

mongoose.connect(process.env.MONGOLAB_URI || 'mongodb://localhost/daic')

var userSchema = Schema({}, {
  autoIndex: true,
  versionKey: false
})

userSchema.virtual('password').set(function (password) {
  this.setPassword(password, function (err, user) {
    user.save() 
  })
})

userSchema.plugin(passportLocalMongoose)

var User = mongoose.model('User', userSchema)

var activitySchema = Schema({
  user: { type: Schema.ObjectId, ref: 'User' },
  hash: String,
  keystrokes: Number,
  timedelta: Number,
  timestamp: Date, 
  _image: Buffer
}, {
  autoIndex: true,
  versionKey: false,
})

activitySchema.pre('save', function (next) {
  this.hash = crypto.createHash('sha256')
    .update(this._image).digest('hex')
  next()
})

activitySchema.virtual('image').set(function (str) {
  this._image = new Buffer(str, 'base64')
}).get(function () {
  return this._image.toSring('base64')
})

var Activity = mongoose.model('Activity', activitySchema)

module.exports = {
  User: User,
  Activity: Activity,
  mongoose: mongoose
}
