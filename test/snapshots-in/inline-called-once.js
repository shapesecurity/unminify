function f() {
  var x = function(a){ return a + foo(); }
  return x(a);
}