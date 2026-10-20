const {createRequire}=require('node:module');
exports.load=name=>{
 try{return require(name);}catch(error){
  const locations=[process.env.WEERLAB_TEST_MODULES,'/opt/homebrew/lib/node_modules/wrangler/node_modules','/Users/aldus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'].filter(Boolean);
  for(const dir of locations){try{return createRequire(dir+'/package.json')(name);}catch{}}
  throw error;
 }
};
