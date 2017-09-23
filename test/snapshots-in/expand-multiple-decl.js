function f(){
  var a = foo(), b = bar();
  for (var c = foo(), d = bar(); false;);
  return a + b + c + d;
}