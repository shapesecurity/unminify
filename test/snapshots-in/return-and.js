function f(){
  return (a = 0, b, c) && d && e;
}

function g(){
  return !a && b === 0 && (c = 0, d, e) && f && g;
}

function h(){
  return !a && b === 0 && (c = 0, d, e);
}

function i(){
  return a && (b, c);
}
