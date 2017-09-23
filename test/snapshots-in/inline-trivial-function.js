function f(){
  var x = {
    p: function (a, b, c) {
      return a + b + c;
    },
  };

  console.log(x.p(foo(), bar(), baz()));  
}
