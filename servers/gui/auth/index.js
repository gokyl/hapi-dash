/**
 * Created by kidtronnix on 20/05/14.
 */

var Joi = require('joi');
var MongoDB = require('mongodb').Db;
var Server = require('mongodb').Server;
var ObjectId = require('mongodb').ObjectID;
var Bcrypt = require('bcrypt-nodejs');
var Jwt = require('jsonwebtoken');
var nodemailer = require('nodemailer');
var Nipple = require('nipple');
var Hawk = require('hawk');

var db = new MongoDB('hapi-dash', new Server('127.0.0.1', '27017', {auto_reconnect: true}), {w: 1});
db.open(function(e, d) {
    if (e) {
        console.log(e);
    } else{
        console.log('connected to database :: hapi-dash');
    }
});

var jwtSecret = 'MY super secure server side secret';
var forgotSecret = 'MY super secure different server side secret';

var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'hapi.dashboard@gmail.com',
        pass: 'hapihapijoijoi'
    }
});



var coreCreds = {
    id: "core",
    key: 'ya3ESSappr5etWCkvpbgST09NHozozs4',
    algorithm: 'sha256'
}

var apiIP = '127.0.0.1:3000';

var API = {
    call: function(opts) {
        var url = 'http://0.0.0.0:3000'+opts.url;
        var requestOptions = {                   
            headers: { 'content-type':'application/json'}
        };

        // Add payload
        if(opts.payload) {
            requestOptions.payload = JSON.stringify(opts.payload);
        }
        // Add auth
        var header = Hawk.client.header(url, opts.method, { credentials: opts.credentials });
        requestOptions.headers.Authorization = header.field;
        
        // Make call
        if(opts.method === 'POST')
        {
            Nipple.post(url, requestOptions, opts.callback)
        }
        else if(opts.method === 'PUT')
        {
            Nipple.put(url, requestOptions, opts.callback)
        }
        else
        {
            Nipple.get(url, requestOptions, opts.callback)
        }
    }
};

var users = {
    john: {
        id: 'john',
        password: 'password',
        name: 'John Doe'
    }
};

exports.register = function(plugin, options, next) {

    var forgot = function (plugin, next) {

        return {
            handler: function(request, next) {


                var uDeets = request.payload;
                // Validate payload
                // Validate payload
                var validSchema = Joi.object().keys({
                    email: Joi.string().required()
                })

                // We got everything we need to create a new user
                Joi.validate(uDeets, validSchema, function (err, value) {
                    if(err !== null) {
                        next({error: true, details: 'Incorrect email'}).type('application/json');
                    }
                    else {
                        var collection = db.collection('users');
                        collection.findOne({"email": uDeets.email}, function(err, user) {
                            if(err) throw err;
                       
                            // Check we have a user
                            if(user) {

                                delete user.password;
                                // Generate a forgot access token and email it to them
                                var token = Jwt.sign(user, forgotSecret, { expiresInMinutes: 60 });

                                var opts = {
                                    payload: JSON.stringify({forgotToken: token}),
                                    headers:   { 'content-type':'application/json'}
                                };


                                API.call({
                                    method: 'PUT',
                                    url: '/api/user/'+user._id,
                                    payload: {
                                        forgotToken: token
                                    },
                                    credentials: coreCreds,
                                    callback: function (err, res, payload) {
                                        
                                        // Update user to be 
                                        var link = "http://localhost:3020/reset/"+token;

                                        // setup e-mail data with unicode symbols
                                        var mailOptions = {
                                            from: "Hapi Dash <hapi.dashboard@gmail.com>", // sender address
                                            to: user.email, // list of receivers
                                            subject: "Reset Password", // Subject line
                                            text: "Hi,\nHere is your password reset link:\n\n"+link+"\n\nThis token will expire in 1 hour.\n\nThe Team", // plaintext body
                                            html: "<p>Hi,</br>Here is you password reset link:</p><p><a href='"+link+"'>"+link+"</a></p><p>This token will expire in 1 hour.</p><p>The Team</p>" // html body
                                        }

                                        // send mail with defined transport object
                                        transporter.sendMail(mailOptions, function(error, response){
                                            if(error) {
                                                console.log(error);
                                            } else {
                                                console.log("Password reset message sent: " + response.message);
                                            }

                                            // if you don't want to use this transport object anymore, uncomment following line
                                            //smtpTransport.close(); // shut down the connection pool, no more messages
                                        });

                                        next({error: false, token: token});

                                    }
                                });

                                     
                            } else {
                                // Throw error if we didn't find an email
                                next({error: true, details: 'Incorrect email'}).type('application/json');
                            }                   
                        });
                    }
                })        
               
            }
        }
    };

    var register = function (plugin, next) {

        return {
            handler: function(request, next) {

                var newUser = request.payload;

                var validSchema = Joi.object().keys({
                    fname: Joi.string().required(),
                    lname: Joi.string().required(),
                    email: Joi.string().email().required(),
                    password: Joi.string().alphanum().required().min(5).max(15),
                    password2: Joi.any().valid(newUser.password)
                })

                // We got everything we need to create a new user
                Joi.validate(newUser, validSchema, {abortEarly: false}, function (err, value) {
                    if(err !== null) {
                        console.log(err)

                        var message = '';
                        for(i=0; i < err.details.length; i++)
                        {
                            var _message = err.details[i].message;
                            if(err.details[i].path == 'password2') {
                                message += 'Passwords must match. '
                            } else {
                                message += _message.substr(0, 1).toUpperCase() + _message.substr(1) +'. ';
                            }  
                        }
                                           
                        return next({error: true, details: message}).type('application/json');
                    } else {
                        delete newUser.password2;

                        API.call({
                            method: 'POST',
                            url: '/api/user',
                            payload: newUser,
                            credentials: coreCreds,
                            callback: function(err, res, payload) {
                                if (err) throw err;

                                var response = JSON.parse(payload);

                                if(response.error) {
                                    return next({error: true, details: 'Error registering.'}).type('application/json');
                                } else {
                                    var token = Jwt.sign({id:response._id}, forgotSecret);
                                    var link = "http://localhost:3020/activate/"+token;
                                    // setup e-mail data with unicode symbols
                                    var mailOptions = {
                                        from: "Hapi Dash <hapi.dashboard@gmail.com>", // sender address
                                        to: response.email, // list of receivers
                                        subject: "Activate your Account", // Subject line
                                        text: "Hi,\nThank you for registering. Please click the following link to activate your account:\n\n"+link+"\n\nThanks for your cooperation.\n\nThe Team", // plaintext body
                                        html: "<p>Hi,</br>Thank you for registering. Please click the following link to activate your account:</p><p><a href='"+link+"'>"+link+"</a></p><p>Thanks for your cooperation.</p><p>The Team</p>" // html body
                                    }

                                    // send mail with defined transport object
                                    // send mail with defined transport object
                                    transporter.sendMail(mailOptions, function(error, info){
                                        if(error){
                                            console.log(error);
                                        }else{
                                            console.log('Message sent: ' + info.response);
                                        }
                                    });
                                    return next({error: false, details: 'Success! An activation email has been sent to you.'}).type('application/json');
                                }
                            }
                        });                      
                    }
                })
            }
        }
    };

    var resetPass = function (plugin, next) {

        return {
            handler: function(request, next) {
                var changePass = request.payload;

                var validSchema = Joi.object().keys({
                    email: Joi.string().email().required(),
                    password: Joi.string().alphanum().required().min(5).max(15),
                    password2: Joi.any().valid(changePass.password),
                    token: Joi.string().required()
                })

                Joi.validate(changePass, validSchema,{abortEarly: false}, function (err, value) {
                    if(err !== null) {
                        var message = '';
                        for(i=0; i < err.details.length; i++)
                        {
                            var _message = err.details[i].message;
                            if(err.details[i].path == 'password2') {
                                message += 'Passwords must match. '
                            } else {
                                message += _message.substr(0, 1).toUpperCase() + _message.substr(1) +'. ';
                            }  
                        }
                                           
                        return next({error: true, details: message}).type('application/json');
                    } else {

                        var collection = db.collection('users');
                        collection.findOne({"email": changePass.email}, function(err, user) {
                            if(err) throw err;
                            // We are only going to change if we 
                            // 1. have a user
                            // 2. we have the same token in DB
                            // 3. Token is valid and not expired
                            if(user && (user.forgotToken === changePass.token)) {
                                Jwt.verify(user.forgotToken, forgotSecret, function(err, decoded) {
                                    if (err) {
                                        throw err;
                                        next({error: true, details: 'Incorrect Token'});
                                    } else {
                                        var payload = {password: changePass.password, forgotToken: false}
                                        console.log(payload)
                                        API.call({
                                            method: 'PUT',
                                            url: '/api/user/'+user._id,
                                            payload: payload,
                                            credentials: coreCreds,
                                            callback: function(err, res, payload) {
                                                if (err) throw err; 
                                                next({error: false, details: 'Changed Password'});
                                            }
                                        });
                                    }

                                });
                            } else {
                                next({error: true, details: 'Incorrect Token'});
                            }
                        })             
                    }
                })       
            }
        }
    };

    var login = function (request, reply) {



        if (request.auth.isAuthenticated) {
            return reply.redirect('/');
        }

        var message = '', error = true;
        var account = null;

        if (!request.payload.email || !request.payload.password) {
            message = 'Missing username or password';
            return reply({error: true, details: message})
        }
        else {
            var collection = db.collection('users');
            collection.findOne({"email": request.payload.email}, function(err, user) {
                if(err) throw err;
                
                // Check we have a user and correct password
                if(!user || !Bcrypt.compareSync(request.payload.password, user.password) ) {
                    message = 'Invalid email or password';
                } else if(!user.activated) {
                    message = 'Activate your account. Check your email.';
                } else {
                    request.auth.session.set({
                        id: user._id,
                        password: request.payload.password
                    });
                    error = false;
                    message = 'Successfully authenticated!';    
                }

                return reply({error: error, details: message})
            })
        }       
    };

    var logout = function (request, reply) {

        request.auth.session.clear();
        return reply.redirect('/login');
    }

    var activate = function (request, reply) {

        Jwt.verify(request.params.token, forgotSecret, function(err, decoded) {
            if (err) {
                throw err;
                return next({error: true, details: 'Incorrect Token!'});
            } else {

                API.call({
                    method: 'PUT',
                    url: '/api/user/'+decoded.id,
                    payload: {activated: true},
                    credentials: coreCreds,
                    callback: function(err, res, payload) {
                        if (err) throw err; 
                        
                        return reply.redirect('/login');
                    }
                });
            }
        });
    }

    plugin.route({
        method: 'POST',
        path: '/login',
        config: {
            handler: login,
            auth: {
                mode: 'try',
                strategy: 'session'
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            }
        }
    })

    plugin.route({
        method: 'GET',
        path: '/logout',
        config: {
            handler: logout,
            auth: 'session'
        }
    })

    plugin.route({
        method: 'GET',
        path: '/activate/{token}',
        config: {
            handler: activate
        }
    })

    // This is the routes for the plugin
    plugin.route({
        path: "/forgot",
        method: "POST",
        config: forgot()
    });

    // This is the routes for the plugin
    plugin.route({
        path: "/reset",
        method: "POST",
        config: resetPass()
    });

    // This is the routes for the plugin
    plugin.route({
        path: "/register",
        method: "POST",
        config: register()
    });

    plugin.route({
        path: "/reset/{token}",
        method: "GET",
        config: {
            handler: function(request, reply) {
                return reply.view('reset', {
                    title: 'Hapi Dash - Boiler Plate App',
                    token: request.params.token
                });
            }
        }
    });

    next();
}