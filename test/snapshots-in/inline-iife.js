function f () {
  (function() {
    foo();
  })();

  x = function(){ return 0; }();
  x = function(){ foo(); }();
}
