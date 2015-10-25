var path = require('path')
var coinbase = require('coinbase')
var express = require('express')
var restify = require('express-restify-mongoose')
var passport = require('passport')
var passportLocal = require('passport-local')
var bodyParser = require('body-parser')
var cookieParser = require('cookie-parser')
var cookieSession = require('cookie-session')
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
var Activity = models.Activity
var Order = models.Order

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
app.use(cookieSession({
  secret: 'L8cjAqiaQkZxRlLa6M4m1C5TyvMmOAiIOT',
  cookie: { maxAge: 60 * 60 * 1000 }
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

var processActivities = function (next) {
  return function (err, activities) {
    if (err) return next(err)
    if (activities && activities.length) {
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
      return next(null, {
        until: activity.timestamp,
        daily: daily,
        dates: dates,
        usd: usd,
        hours: hours,
        mins: mins
      }) 
    }
    next(null, {
      daily: {},
      dates: [],
      usd: 0,
      hours: 0,
      mins: 0
    })
  }
}

router.get('/current', ensureAuth, function (req, res) {
  var op = Activity.find({ _archived: false })
    .sort('timestamp').populate('user')
  op.exec(processActivities(function (err, result) {
    if (err) return res.status(500)
    if (result.dates.length) {
      var order = new Order({ until: result.until })
      return order.save(function (err, order) {
        coinbaseClient.createCheckout({
          amount: result.usd.toFixed(2),
          currency: 'USD',
          name: 'Development services',
          description: result.hours + 'h ' +
            result.mins + 'm ' +
            'between ' + result.dates[0] +
            ' and ' + result.dates[result.dates.length-1],
          type: 'order',
          style: 'custom_large',
          success_url: 'http://daic-smoogs.herokuapp.com/current',
          cancel_url: 'http://daic-smoogs.herokuapp.com/current',
          auto_redirect: true,
          metadata: {
            order: order.id 
          }
        }, function (err, checkout) {
          if (err) return res.status(500)
          res.render('activity', { 
            active: 'current',
            prefix: prefix, 
            daily: result.daily, 
            checkout: checkout,
            order: order
          })
        })
      })
    } 
    res.render('activity', { 
      active: 'current',
      prefix: prefix, 
      daily: {}, 
      checkout: {} 
    })
  }))
})

router.get('/archived', ensureAuth, function (req, res) {
  var op = Activity.find({ _archived: true })
    .sort('timestamp').populate('user')
  op.exec(processActivities(function (err, result) {
    if (err) return res.status(500)
    if (result.dates.length) {
      return res.render('activity', { 
        active: 'archived',
        prefix: prefix, 
        daily: result.daily, 
        checkout: {} 
      })
    } 
    res.render('activity', { 
      active: 'archived',
      prefix: prefix, 
      daily: {}, 
      checkout: {} 
    })
  }))
})

router.post('/ack', function (req, res) {
  console.log("CUSTOM", req.params.order.custom)
  res.end()
})

router.get('/media/:hash', function (req, res) {
  var params = req.params
  var query = { hash: params.hash }
  Activity.findOne(query, function (err, activity) {
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

restify.serve(router, Activity, {
  plural: true,
  lowercase: true,
  preMiddleware: ensureAuthRest,
  findOneAndUpdate: false,
  findOneAndRemove: false,
  preCreate: addRelationship,
  preDelete: ensureCreatorRest
})

restify.serve(router, User, {
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
