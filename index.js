var path = require('path')
var through2 = require('through2')
var gutil = require('gulp-util')
var _ = require('lodash')
var phridge = require('phridge')
var fs = require('fs')
var when = require('when')
var cheerio = require('cheerio')
var Backpacking = require('backpacking')

var SPRITE_TEMPLATE = path.join(__dirname, 'templates', 'sprite.html')

module.exports = function (options) {

  var svgs = {}
  var fileName
  var opts = _.extend({
    cssTemplate: path.join(__dirname, 'templates', 'style.css')
  , backgroundUrl: false
  , spriteWidth: 400
  }, options)


  return through2.obj(

    function transform (file, encoding, cb) {
      if (file.isStream()) {
        return cb(new gutil.PluginError('gulp-svgfallback', 'Streams are not supported!'))
      }

      var name = path.basename(file.relative, path.extname(file.relative))

      if (!fileName) {
        fileName = path.basename(file.base)
        if (fileName === '.' || !fileName) {
          fileName = 'svgfallback'
        } else {
          fileName = fileName.split(path.sep).shift()
        }
      }

      if (name in svgs) {
        return cb(new gutil.PluginError('gulp-svgfallback', 'File name should be unique: ' + name))
      }

      if (!file.cheerio) {
        file.cheerio = cheerio.load(file.contents.toString(), { xmlMode: true })
      }

      svgs[name] = {
        contents: file.contents.toString()
      , width: parseInt(file.cheerio('svg').attr('width'), 10)
      , height: parseInt(file.cheerio('svg').attr('height'), 10)
      }

      cb()
    }

  , function flush (cb) {

      if (Object.keys(svgs).length === 0) return cb()

      var self = this
      var height = _.reduce(svgs, function (total, svg) {
        return svg.height + total
      }, 0)
      var backpacking = new Backpacking(opts.spriteWidth, height)
      var icons = _.map(svgs, function (svg, name) {
        return { id: name
               , width: svg.width
               , height: svg.height
               }
      })
      icons = backpacking.pack(icons)
      icons = _.map(icons, function (icon) {
        return { contents: svgs[icon.box.id].contents
               , name: icon.box.id
               , width: icon.box.width
               , height: icon.box.height
               , left: icon.x
               , top: icon.y
               }
      })

      var clipRect = {
        left: 0
      , top: 0
      , right: Math.max.apply(Math, _.map(icons, function (i) { return i.left + i.width }))
      , bottom: Math.max.apply(Math, _.map(icons, function (i) { return i.top + i.height }))
      }

      renderTemplate(SPRITE_TEMPLATE, {icons: icons})
        .then(function (html) {
          return generateSprite({ content: html, clipRect: clipRect })
        })
        .then(function (sprite) {

          self.push(new gutil.File({
            path: fileName + '.png'
          , contents: new Buffer(sprite, 'base64')
          }))

          return renderTemplate(opts.cssTemplate, {
            backgroundUrl: opts.backgroundUrl || fileName + '.png'
          , icons: icons
          })

        })
        .done(
          function (css) {
            self.push(new gutil.File({
              path: fileName + '.css'
            , contents: new Buffer(css)
            }))
            cb()
          }
        , function (err) {
            cb(new gutil.PluginError('gulp-svgfallback', err))
          }
        )
    }
  )
}


function renderTemplate (fileName, options) {
  return when.promise(function (resolve, reject) {
    fs.readFile(fileName, function (err, template) {
      if (err) return reject(err)
      try {
        resolve(_.template(template, options))
      } catch (err) {
        reject(err)
      }
    })
  })
}


function generateSprite (opts) {
  return phridge.spawn()
    .then(function (phantom) {
      return phantom
        .run(opts, phantomScript)
        .finally(phantom.dispose.bind(phantom))
    })
}


function phantomScript (opts, resolve) {
  var page = webpage.create()  // jshint ignore: line
  page.viewportSize = { width: opts.clipRect.right, height: 1 }
  page.content = opts.content
  page.clipRect = opts.clipRect
  resolve(page.renderBase64('PNG'))
}
