if(a(), b()) {
  c();
}
function f(){
  var a = (b(), c);
  return d(), a;
}
throw f(), g;
for((a(), b()); false;);