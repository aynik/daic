var path = require('path')
var coinbase = require('coinbase')
var express = require('express')
var restify = require('express-restify-mongoose')
var passport = require('passport')
var passportLocal = require('passport-local')
var bodyParser = require('body-parser')
var cookieParser = require('cookie-parser')
var flash = require('connect-flash')
var serveStatic = require('serve-static')
var session = require('express-session')
var swig = require('swig')
var models = require('./models')

var app = express()
var router = express.Router()

var USD_RATE = 0.5 // Per 1min

var coinbaseKey = process.env.COINBASE_KEY || ''
var coinbaseSecret = process.env.COINBASE_SECRET || ''
var prefix = process.env.PREFIX || 'sandbox'
var port = process.env.PORT || 7000

var CoinbaseClient = coinbase.Client
var LocalStrategy = passportLocal.Strategy
var User = models.User

app.set('views', __dirname + '/views')
app.engine('html', swig.renderFile);
app.set('view engine', 'html');

app.use(flash())
app.use(cookieParser())
app.use(bodyParser.json({
  limit: '1mb'
}))
app.use(bodyParser.urlencoded({ 
  extended: true 
}))
app.use(session({ 
  secret: 'L8cjAqiaQkZxRlLa6M4m1C5TyvMmOAiIOT',
  resave: false,
  saveUninitialized: false
}))
app.use(serveStatic('public'))

passport.use(User.createStrategy()) 
passport.serializeUser(User.serializeUser())
passport.deserializeUser(User.deserializeUser())

app.use(passport.initialize())
app.use(passport.session())

var coinbaseClient = new CoinbaseClient({
  apiKey: coinbaseKey,
  apiSecret: coinbaseSecret
})

var ensureAuth = function (req, res, next){
  if (req.isAuthenticated()) {
    return next()
  } 
  res.redirect('/login')
}

var forbidReauth = function (req, res, next){
  if (!req.isAuthenticated()) {
    return next()
  } 
  res.redirect('/')
}

var unpackFlash = function(req, res, next) {
  var flash = req.session.flash
  if (flash && 'error' in flash) {
    req.session.messages = []
    for (var i = 0, l = flash.error.length; i < l; ++i) {
      var error = flash.error[i]
      var match = error.match(/^(\w+):\s?(.*)$/)
      if (match) {
        req.session.messages.push({
          type: match[1],
          text: match[2]
        })
      } else {
        req.session.messages.push({
          type: 'error',
          text: error 
        })
      }
    }
    req.session.flash.error = []
  }
  return next()
}

router.get('/login', forbidReauth, unpackFlash, function (req, res) {
  res.render('login', { prefix: prefix, messages: req.session.messages || [] })
})

router.post('/login', passport.authenticate('local', {
  failureRedirect: '/login',
  failureFlash: true
}), function (req, res) {
  req.login(req.user, function (err) {
    if (err) return next(err)
    res.redirect('/')
  })
})

router.get('/logout', ensureAuth, function (req, res) {
  req.logout()
  res.redirect('/')
})

router.get('/', ensureAuth, function (req, res) {
  res.redirect('/current')
})

router.get('/current', ensureAuth, function (req, res) {
  
  var op = models.Activity.find().sort('timestamp').populate('user')
  op.exec(function (err, activities) {
    var activity
    var date
    var daily = {}
    var minutes = 0
    for (var a = 0, l = activities.length; a < l; a++) {
      activity = activities[a]
      date = activity.timestamp.toISOString().split('T')[0]
      daily[date] = daily[date] || []
      daily[date].push(activities[a])
      minutes += Math.round(activity.timedelta / 1000 / 60) 
    } 
    var usd = minutes * USD_RATE 
    var dates = Object.keys(daily).map(function (date) {
      return date.split('-').reverse().join('/')
    })
    var hours = Math.ceil(minutes / 60)
    var mins = minutes % 60
    coinbaseClient.createCheckout({
      amount: usd.toFixed(2),
      currency: 'USD',
      name: 'Development services',
      description: hours + 'h ' + mins + 'm ' +
        'between ' + dates[0] + ' and ' + dates[dates.length-1],
      type: 'order',
      style: 'custom_small',
      success_url: 'http://daic-smoogs.herokuapp.com/current',
      cancel_url: 'http://daic-smoogs.herokuapp.com/current',
      auto_redirect: true,
      metadata: {
        until: activities[activities.length-1].timestamp 
      }
    }, function (err, checkout) {
      if (err) return res.status(500)
      res.render('activity', { 
        prefix: prefix, 
        daily: daily, 
        checkout: checkout 
      })
    })
  })
})

router.get('/media/:hash', function (req, res) {
  var params = req.params
  var query = { hash: params.hash }
  models.Activity.findOne(query, function (err, activity) {
    if (err) return res.status(500)
    res.setHeader('Content-Type', 'image/jpg')
    res.send(activity._image)
  })
})

var ensureAuthRest = function (req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.sendStatus(401)
}

var addRelationship = function (req, res, next) {
  req.body = req.body || {}
  req.body.user = req.user._id
  next()
} 

var ensureCreatorRest = function (req, res, next) {
  if (req.erm.document.user === req.user._id) {
    return next() 
  } 
  res.sendStatus(403)
}

restify.serve(router, models.Activity, {
  plural: true,
  lowercase: true,
  preMiddleware: ensureAuthRest,
  findOneAndUpdate: false,
  findOneAndRemove: false,
  preCreate: addRelationship,
  preDelete: ensureCreatorRest
})

restify.serve(router, models.User, {
  plural: true,
  lowercase: true,
  preMiddleware: ensureAuthRest,
  findOneAndUpdate: false,
  findOneAndRemove: false,
  preDelete: ensureCreatorRest
})

app.use('/', router)

app.listen(port, function () {
  console.info('listening: http://localhost:' + port)
})
