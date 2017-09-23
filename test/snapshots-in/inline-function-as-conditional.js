function f(){

  var x = function (foo) { if (foo == 'bar') return 'a'; else return 'b'; };
  var y = x(a);
  var z = x(b);
  var w = x();
  return y + z + w;
}
