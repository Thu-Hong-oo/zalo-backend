const Joi = require('joi');

const createGroupSchema = Joi.object({
  name: Joi.string().allow('', null),
  members: Joi.array().items(Joi.string()).min(2).required(),
  createdBy: Joi.string().required()
}).unknown(true);

const updateGroupSchema = Joi.object({
  name: Joi.string().optional(),
  avatar: Joi.string().uri().optional()
}).unknown(true);

const addMemberSchema = Joi.object({
  userId: Joi.string().required(),
  role: Joi.string().valid('ADMIN', 'DEPUTY', 'MEMBER').default('MEMBER')
});

const updateMemberSchema = Joi.object({
  role: Joi.string().valid('ADMIN', 'DEPUTY', 'MEMBER').required()
});

module.exports = {
  createGroupSchema,
  updateGroupSchema,
  addMemberSchema,
  updateMemberSchema
}; 