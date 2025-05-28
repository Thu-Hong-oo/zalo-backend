const express = require('express');
const router = express.Router();
const friendController = require('./controller');


router.post("/request", friendController.sendFriendRequest);
router.get('/request/sent/:userId', friendController.getSentRequests);
router.get('/request/received/:userId', friendController.getReceivedRequests);
router.post('/request/accept', friendController.acceptFriendRequest);
router.post('/request/reject', friendController.rejectFriendRequest);
router.post('/request/cancel', friendController.cancelFriendRequest);
router.get('/list/:userId', friendController.getFriendsList);
router.post("/delete", friendController.deleteFriend);


module.exports = router; 