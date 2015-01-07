/**
 * @file gulpfile.js
 *
 * Defines tasks that can be run on gulp.
 *
 * Summary:
 * - `coverage` - run `istanbul` with mocha to generate a report of test coverage
 * - `jsdoc` - run `jsdoc` to generate the API reference
 * - `coveralls` - updates coveralls info
 * - `release` - automates release process (only for bitcore maintainers)
 */
'use strict';

var gulp = require('gulp');
var coveralls = require('gulp-coveralls');
var jshint = require('gulp-jshint');
var mocha = require('gulp-mocha');
var runSequence = require('run-sequence');
var shell = require('gulp-shell');
var through = require('through2');
var gutil = require('gulp-util');
var jsdoc2md = require('jsdoc-to-markdown');
var mfs = require('more-fs');

var files = ['lib/**/*.js'];
var tests = ['test/**/*.js'];
var alljs = files.concat(tests);

function ignoreError() {
  /* jshint ignore:start */ // using `this` in this context is weird 
  this.emit('end');
  /* jshint ignore:end */
}

var testMocha = function() {
  return gulp.src(tests).pipe(new mocha({
    reporter: 'spec'
  }));
};

/**
 * Testing
 */

gulp.task('test:node', testMocha);

gulp.task('test:node:nofail', function() {
  return testMocha().on('error', ignoreError);
});

gulp.task('test', function(callback) {
  runSequence(['test:node'], callback);
});

/**
 * Code quality and documentation
 */

gulp.task('lint', function() {
  return gulp.src(alljs)
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

gulp.task('jsdoc', function() {

  function jsdoc() {
    return through.obj(function(file, enc, cb) {

      if (file.isNull()) {
        cb(null, file);
        return;
      }
      if (file.isStream()) {
        cb(new gutil.PluginError('gulp-jsdoc2md', 'Streaming not supported'));
        return;
      }
      var destination = 'docs/api/' + file.path.replace(file.base, '').replace(/\.js$/, '.md');
      jsdoc2md.render(file.path, {})
        .on('error', function(err) {
          gutil.log(gutil.colors.red('jsdoc2md failed', err.message));
        })
        .pipe(mfs.writeStream(destination));
      cb(null, file);
    });
  }

  return gulp.src(files).pipe(jsdoc());

});

gulp.task('coverage', shell.task(['node_modules/.bin/./istanbul cover node_modules/.bin/_mocha -- --recursive']));

gulp.task('coveralls', ['coverage'], function() {
  gulp.src('coverage/lcov.info').pipe(coveralls());
});

