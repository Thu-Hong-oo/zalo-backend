const express = require('express');
const router = express.Router();
const groupController = require('./group.controller');
const auth = require('../../middleware/auth');
const { authenticate } = require('../../middleware/auth');
const upload = require('../../config/multer');

// Group routes
router.post('/', auth, groupController.createGroup);
router.get('/:groupId', auth, groupController.getGroup);
router.put('/:groupId', auth, groupController.updateGroup);
router.delete('/:groupId', auth, groupController.deleteGroup);

// Member routes
router.post('/:groupId/members', auth, groupController.addMember);
router.get('/:groupId/members', auth, groupController.getMembers);
router.put('/:groupId/members/:memberId/role', auth, groupController.updateMember);
router.delete('/:groupId/members/:memberId', auth, groupController.removeMember);

// User groups
router.get('/users/:userId/groups', auth, groupController.getUserGroups);

// Message read status
router.put('/:groupId/members/:memberId/last-read', auth, groupController.updateLastRead);

// Cập nhật avatar nhóm
router.put('/:groupId/avatar', 
  auth,
  upload.single('avatar'),
  groupController.updateGroupAvatar
);

// Cập nhật tên nhóm
router.put('/:groupId/name',
  auth,
  groupController.updateGroupName
);

module.exports = router; 