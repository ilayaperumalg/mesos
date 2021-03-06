'use strict';

var slaves = [];


// Table Object.
//   selected_column: column predicate for the selected column.
//   reverse:         boolean indicating sort order.
function Table(selected_column) {
  if (this instanceof Table) {
    this.selected_column = selected_column;
    this.reverse = true;
  } else {
    return new Table(selected_column);
  }
}


function hasSelectedText () {
  if (window.getSelection) {  // All browsers except IE before version 9.
    var range = window.getSelection();
    return range.toString().length > 0;
  }
  return false;
}


// Returns a curried function for returning the HTML 'class=' tag
// attribute value for sorting table columns in the provided scope.
function columnClass($scope) {
  // For the given table column, this behaves as follows:
  // Column unselected            : 'unselected'
  // Column selected / descending : 'descending'
  // Column selected / ascending  : 'ascending'
  return function(table, column) {
    if ($scope.tables[table].selected_column === column) {
      if ($scope.tables[table].reverse) {
        return 'descending';
      } else {
        return 'ascending';
      }
    }
    return 'unselected';
  }
}


// Returns a curried function to be called when a table column is clicked
// in the provided scope.
function selectColumn($scope) {
  // Assigns the given table column as the sort column, flipping the
  // sort order if the sort column has not changed.
  return function(table, column) {
    if ($scope.tables[table].selected_column === column) {
      $scope.tables[table].reverse = !$scope.tables[table].reverse;
    } else {
      $scope.tables[table].reverse = true;
    }
    $scope.tables[table].selected_column = column;
  }
}


// Invokes the pailer for the specified host and path using the
// specified window_title.
function pailer(host, path, window_title) {
  var url = 'http://' + host + '/files/read.json?path=' + path;
  var pailer =
    window.open('/static/pailer.html', url, 'width=580px, height=700px');

  // Need to use window.onload instead of document.ready to make
  // sure the title doesn't get overwritten.
  pailer.onload = function() {
    pailer.document.title = window_title + ' (' + host + ')';
  }
}


// Update the outermost scope with the new state.
function update($scope, $defer, data) {
  // Don't do anything if the data hasn't changed.
  if ($scope.data == data) {
    return true; // Continue polling.
  }

  $scope.state = $.parseJSON(data);

  // Determine if there is a leader (and redirect if not the leader).
  if (!$scope.state.leader) {
    $("#no-leader-alert").show();
  } else {
    $("#no-leader-alert").hide();

    // Redirect if we aren't the leader.
    if ($scope.state.leader != $scope.state.pid) {
      $scope.redirect = 6000;
      $scope.leader = $scope.state.leader.split("@")[1];
      $("#not-leader-alert").show();

      var countdown = function() {
        if ($scope.redirect == 0) {
          // TODO(benh): Use '$window'.
          window.location = 'http://' + $scope.leader;
        } else {
          $scope.redirect = $scope.redirect - 1000;
          $defer(countdown, 1000);
        }
      }
      countdown();
      return false; // Don't continue polling.
    }
  }

  // Check for selected text, and allow up to 20 seconds to pass before
  // potentially wiping the user highlighted text.
  // TODO(bmahler): This is to avoid the annoying loss of highlighting when
  // the tables update. Once we can have tighter granularity control on the
  // angular.js dynamic table updates, we should remove this hack.
  $scope.time_since_update += $scope.delay;

  if (hasSelectedText() && $scope.time_since_update < 20000) {
    return true;
  }

  $scope.data = data;

  // Update the maps.
  $scope.slaves = {};
  $scope.frameworks = {};
  $scope.offers = {};
  $scope.completed_frameworks = {};

  _.each($scope.state.slaves, function(slave) {
    $scope.slaves[slave.id] = slave;
  });

  _.each($scope.state.frameworks, function(framework) {
    $scope.frameworks[framework.id] = framework;
    _.each(framework.offers, function(offer) {
      $scope.offers[offer.id] = offer;
    });
  });

  _.each($scope.state.completed_frameworks, function(framework) {
    $scope.completed_frameworks[framework.id] = framework;
  });

  // Update the stats.
  $scope.cluster = $scope.state.cluster;
  $scope.total_cpus = 0;
  $scope.total_mem = 0;
  $scope.used_cpus = 0;
  $scope.used_mem = 0;
  $scope.offered_cpus = 0;
  $scope.offered_mem = 0;

  $scope.staged_tasks = $scope.state.staged_tasks;
  $scope.started_tasks = $scope.state.started_tasks;
  $scope.finished_tasks = $scope.state.finished_tasks;
  $scope.killed_tasks = $scope.state.killed_tasks;
  $scope.failed_tasks = $scope.state.failed_tasks;
  $scope.lost_tasks = $scope.state.lost_tasks;

  $scope.activated_slaves = $scope.state.activated_slaves;
  $scope.connected_slaves = $scope.state.connected_slaves;

  _.each($scope.slaves, function(slave) {
    $scope.total_cpus += slave.resources.cpus;
    $scope.total_mem += slave.resources.mem;
  });

  _.each($scope.frameworks, function(framework) {
      $scope.used_cpus += framework.resources.cpus;
      $scope.used_mem += framework.resources.mem;
      $scope.active_tasks += framework.tasks.length;
      $scope.completed_tasks += framework.completed_tasks.length;

      framework.cpus_share = 0;
      if ($scope.total_cpus > 0) {
        framework.cpus_share = framework.resources.cpus / $scope.total_cpus;
      }

      framework.mem_share = 0;
      if ($scope.total_mem > 0) {
        framework.mem_share = framework.resources.mem / $scope.total_mem;
      }

      framework.max_share = Math.max(framework.cpus_share, framework.mem_share);
  });

  _.each($scope.offers, function(offer) {
    $scope.offered_cpus += offer.resources.cpus;
    $scope.offered_mem += offer.resources.mem;
    offer.framework_name = $scope.frameworks[offer.framework_id].name;
    offer.hostname = $scope.slaves[offer.slave_id].hostname;
  });

  $scope.used_cpus -= $scope.offered_cpus;
  $scope.used_mem -= $scope.offered_mem;

  $scope.idle_cpus = $scope.total_cpus - ($scope.offered_cpus + $scope.used_cpus);
  $scope.idle_mem = $scope.total_mem - ($scope.offered_mem + $scope.used_mem);

  $scope.time_since_update = 0;
  $.event.trigger('state_updated');

  return true; // Continue polling.
}


// Main controller that can be used to handle "global" events. E.g.,:
//     $scope.$on('$afterRouteChange', function() { ...; });
//
// In addition, the MainCntl encapsulates the "view", allowing the
// active controller/view to easily access anything in scope (e.g.,
// the state).
function MainCntl($scope, $http, $route, $routeParams, $location, $defer) {
  // Turn off the loading gif, turn on the navbar.
  $("#loading").hide();
  $("#navbar").show();

  // Adding bindings into scope so that they can be used from within
  // AngularJS expressions.
  $scope._ = _;
  $scope.stringify = JSON.stringify;
  $scope.encodeURIComponent = encodeURIComponent;
  $scope.basename = function(path) {
    // This is only a basic version of basename that handles the cases we care
    // about, rather than duplicating unix basename functionality perfectly.
    if (path === '/') {
      return path;  // Handle '/'.
    }

    // Strip a trailing '/' if present.
    if (path.length > 0 && path.lastIndexOf('/') === (path.length - 1)) {
      path = path.substr(0, path.length - 1);
    }
    return path.substr(path.lastIndexOf('/') + 1);
  }

  // Initialize popovers and bind the function used to show a popover.
  Popovers.initialize();
  $scope.popover = Popovers.show;

  $scope.$location = $location;
  $scope.delay = 2000;
  $scope.retry = 0;
  $scope.time_since_update = 0;

  var poll = function() {
    $http.get('master/state.json',
              {transformResponse: function(data) { return data; }})
      .success(function(data) {
        if (update($scope, $defer, data)) {
          $scope.delay = 2000;
          $defer(poll, $scope.delay);
        }
      })
      .error(function() {
        if ($scope.delay >= 128000) {
          $scope.delay = 2000;
        } else {
          $scope.delay = $scope.delay * 2;
        }
        $scope.retry = $scope.delay;
        var countdown = function() {
          if ($scope.retry == 0) {
            $('#error-modal').modal('hide');
          } else {
            $scope.retry = $scope.retry - 1000;
            $scope.countdown = $defer(countdown, 1000);
          }
        }
        countdown();
        $('#error-modal').modal('show');
      });
  }

  // Make it such that everytime we hide the error-modal, we stop the
  // countdown and restart the polling.
  $('#error-modal').on('hidden', function () {
    if ($scope.countdown != undefined) {
      if ($defer.cancel($scope.countdown)) {
        $scope.delay = 2000; // Restart since they cancelled the countdown.
      }
    }

    // Start polling again, but do it asynchronously (and wait at
    // least a second because otherwise the error-modal won't get
    // properly shown).
    $defer(poll, 1000);
  });

  poll();
}


function HomeCtrl($scope) {
  setNavbarActiveTab('home');

  $scope.tables = {};
  $scope.tables['frameworks'] = new Table('id');
  $scope.tables['slaves'] = new Table('id');
  $scope.tables['offers'] = new Table('id');
  $scope.tables['completed_frameworks'] = new Table('id');

  $scope.columnClass = columnClass($scope);
  $scope.selectColumn = selectColumn($scope);

  $scope.log = function($event) {
    if (!$scope.state.log_dir) {
      $('#no-log-dir-modal').modal('show');
    } else {
      pailer(
          $scope.$location.host() + ':' + $scope.$location.port(),
          '/master/log',
          'Mesos Master');
    }
  }
}


function DashboardCtrl($scope) {
  setNavbarActiveTab('dashboard');

  var context = cubism.context()
    .step(1000)
    .size(1440);

  // Create a "cpus" horizon.
  horizons.create(context, "cpus", random(context, "cpus"), [0, 10], "cpus");

  // Create a "mem" horizon.
  horizons.create(context, "mem", random(context, "mem"), [0, 10], "mb");

  // Do any cleanup before we change the route.
  $scope.$on('$beforeRouteChange', function() { context.stop(); });
}


function FrameworksCtrl($scope) {
  setNavbarActiveTab('frameworks');

  $scope.tables = {};
  $scope.tables['frameworks'] = new Table('id');

  $scope.columnClass = columnClass($scope);
  $scope.selectColumn = selectColumn($scope);
}


function FrameworkCtrl($scope, $routeParams) {
  setNavbarActiveTab('frameworks');

  $scope.tables = {};
  $scope.tables['active_tasks'] = new Table('id');
  $scope.tables['completed_tasks'] = new Table('id');

  $scope.columnClass = columnClass($scope);
  $scope.selectColumn = selectColumn($scope);

  var update = function() {
    if ($routeParams.id in $scope.completed_frameworks) {
      $scope.framework = $scope.completed_frameworks[$routeParams.id];
      $scope.alert_message = 'This framework has terminated!';
      $('#alert').show();
      $('#framework').show();
    } else if ($routeParams.id in $scope.frameworks) {
      $scope.framework = $scope.frameworks[$routeParams.id];
      $('#framework').show();
    } else {
      $scope.alert_message = 'No framework found with ID: ' + $routeParams.id;
      $('#alert').show();
    }
  }

  if ($scope.state) {
    update();
  }

  $(document).on('state_updated', update);
  $scope.$on('$beforeRouteChange', function() {
    $(document).off('state_updated', update);
  });
}


function SlavesCtrl($scope) {
  setNavbarActiveTab('slaves');

  $scope.tables = {};
  $scope.tables['slaves'] = new Table('id');

  $scope.columnClass = columnClass($scope);
  $scope.selectColumn = selectColumn($scope);
}


// TODO(bmahler): Pull this apart into:
// SlaveCtrl, SlaveFrameworkCtrl, SlaveExecutorCtrl.
function SlaveCtrl($scope, $routeParams, $http) {
  setNavbarActiveTab('slaves');

  // The slave controller is reused for all slave subpages, so some of the route
  // params may not be present, depending on which page is being routed.
  $scope.slave_id = $routeParams.slave_id;
  if ($routeParams.framework_id) {
    $scope.framework_id = $routeParams.framework_id;
  }
  if ($routeParams.executor_id) {
    $scope.executor_id = $routeParams.executor_id;
  }

  $scope.tables = {};
  $scope.tables['frameworks'] = new Table('id');
  $scope.tables['completed_frameworks'] = new Table('id');
  $scope.tables['executors'] = new Table('id');
  $scope.tables['completed_executors'] = new Table('id');
  $scope.tables['tasks'] = new Table('id');
  $scope.tables['queued_tasks'] = new Table('id');
  $scope.tables['completed_tasks'] = new Table('id');

  $scope.columnClass = columnClass($scope);
  $scope.selectColumn = selectColumn($scope);

  var update = function() {
    if ($routeParams.slave_id in $scope.slaves) {
      var pid = $scope.slaves[$routeParams.slave_id].pid;
      var id = pid.substring(0, pid.indexOf('@'));
      var host = pid.substring(pid.indexOf('@') + 1);

      $scope.log = function($event) {
        if (!$scope.state.log_dir) {
          $('#no-log-dir-modal').modal('show');
        } else {
          pailer(host, '/slave/log', 'Mesos Slave');
        }
      }

      var url = 'http://' + host + '/' + id + '/state.json?jsonp=JSON_CALLBACK';
      $http.jsonp(url)
        .success(function(data) {
          $scope.state = data;

          $scope.slave = {};
          $scope.slave.frameworks = {};
          $scope.slave.completed_frameworks = {};

          $scope.slave.staging_tasks = 0;
          $scope.slave.starting_tasks = 0;
          $scope.slave.running_tasks = 0;

          // Update the framework map.
          _.each($scope.state.frameworks, function(framework) {
            $scope.slave.frameworks[framework.id] = framework;

            var executors = {};
            _.each(framework.executors, function(executor) {
              executors[executor.id] = executor;
            });
            $scope.slave.frameworks[framework.id].executors = executors;

            var completed_executors = {};
            _.each(framework.completed_executors, function(executor) {
              completed_executors[executor.id] = executor;
            });
            $scope.slave.frameworks[framework.id].completed_executors = completed_executors;
          });

          // Update the completed framework map.
          _.each($scope.state.completed_frameworks, function(framework) {
            $scope.slave.completed_frameworks[framework.id] = framework;

            var executors = {};
            _.each(framework.executors, function(executor) {
              executors[executor.id] = executor;
            });
            $scope.slave.completed_frameworks[framework.id].executors = executors;

            var completed_executors = {};
            _.each(framework.completed_executors, function(executor) {
              completed_executors[executor.id] = executor;
            });
            $scope.slave.completed_frameworks[framework.id].completed_executors = completed_executors;
          });

          // Compute the framework stats.
          _.each($scope.slave.frameworks, function(framework) {
            framework.num_tasks = 0;
            framework.cpus = 0;
            framework.mem = 0;

            _.each(framework.executors, function(executor) {
              framework.num_tasks += _.size(executor.tasks);
              framework.cpus += executor.resources.cpus;
              framework.mem += executor.resources.mem;
            });
          });

          // Compute the completed framework stats.
          _.each($scope.slave.completed_frameworks, function(framework) {
            framework.num_tasks = 0;
            framework.cpus = 0;
            framework.mem = 0;

            _.each(framework.executors, function(executor) {
              framework.num_tasks += _.size(executor.tasks);
              framework.cpus += executor.resources.cpus;
              framework.mem += executor.resources.mem;
            });
          });

          // Look for the framework / executor if present in the request.
          if ($scope.framework_id) {
            // Look for the framework.
            if (_.has($scope.slave.frameworks, $scope.framework_id)) {
              $scope.framework = $scope.slave.frameworks[$scope.framework_id];
            } else if (_.has($scope.slave.completed_frameworks, $scope.framework_id)) {
              $scope.framework = $scope.slave.completed_frameworks[$scope.framework_id];
            } else {
              $scope.alert_message = 'No framework found with ID: ' + $scope.framework_id;
              $('#alert').show();
            }

            if ($scope.framework && $scope.executor_id) {
              // Look for the executor.
              if (_.has($scope.framework.executors, $scope.executor_id)) {
                $scope.executor = $scope.framework.executors[$scope.executor_id];
              } else if (_.has($scope.framework.completed_executors, $scope.executor_id)) {
                $scope.executor = $scope.framework.completed_executors[$scope.executor_id];
              } else {
                $scope.alert_message = 'No executor found with ID: ' + $scope.executor_id;
                $('#alert').show();
              }
            }
          }

          if (!$scope.framework_id || $scope.framework) {
            $('#slave').show();
          } else if ($scope.framework && (!$scope.executor_id || $scope.executor)) {
            $('#slave').show();
          }
        })
        .error(function() {
          alert('unimplemented');
        });
    } else {
      $scope.alert_message = 'No slave found with ID: ' + $routeParams.slave_id;
      $('#alert').show();
    }
  }

  if ($scope.state) {
    update();
  }

  $(document).on('state_updated', update);
  $scope.$on('$beforeRouteChange', function() {
    $(document).off('state_updated', update);
  });
}


function BrowseCtrl($scope, $routeParams, $http) {
  setNavbarActiveTab('slaves');

  var update = function() {
    if ($routeParams.slave_id in $scope.slaves && $routeParams.path) {
      $scope.slave_id = $routeParams.slave_id;
      $scope.path = $routeParams.path;

      var pid = $scope.slaves[$routeParams.slave_id].pid;
      var id = pid.substring(0, pid.indexOf('@'));
      var host = pid.substring(pid.indexOf('@') + 1);
      var url = 'http://' + host + '/files/browse.json?jsonp=JSON_CALLBACK';

      $scope.slave_host = host;

      $scope.pail = function($event, path) {
        pailer(host, path, decodeURIComponent(path));
      }

      // TODO(bmahler): Try to get the error code / body in the error callback.
      // This wasn't working with the current version of angular.
      $http.jsonp(url, {params: {path: $routeParams.path}})
        .success(function(data) {
          $scope.listing = data;
          $('#listing').show();
        })
        .error(function() {
          $scope.alert_message = 'Error browsing path: ' + $routeParams.path;
          $('#alert').show();
        });
    } else {
      if (!($routeParams.slave_id in $scope.slaves)) {
        $scope.alert_message = 'No slave found with ID: ' + $routeParams.slave_id;
      } else {
        $scope.alert_message = 'Missing "path" request parameter.';
      }
      $('#alert').show();
    }
  }

  if ($scope.state) {
    update();
  }

  $(document).on('state_updated', update);
  $scope.$on('$beforeRouteChange', function() {
    $(document).off('state_updated', update);
  });
}
