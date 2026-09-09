const { getSession, json } = require('./_lib');
const { cloudRequest } = require('./lib/cloud-patients');
exports.handler = async event => {
 if(event.httpMethod !== 'GET') return json(405,{error:'GET only'});
 const actor=getSession(event);
 if(!actor) return json(401,{error:'Sign in to CrewOS.'});
 const id=String(event.queryStringParameters?.patient || '');
 if(!/^BHW\d{4}$/.test(id)) return json(400,{error:'Select an exact Registry patient.'});
 try {return {...json(200,await cloudRequest(`/v1/patients/${id}/leave-requests`,{actor})),headers:{'Content-Type':'application/json','Cache-Control':'no-store'}};}
 catch(error) {return json(error.status || 503,{error:'Leave requests could not be loaded from BHW Cloud. Reconnect and try again.'});}
};
