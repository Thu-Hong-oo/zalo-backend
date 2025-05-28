const { TABLES } = require('../../config/aws');
const groupService = require('./groupService');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { 
    DynamoDBDocumentClient, 
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

const MEMBER_ROLES = {
  ADMIN: 'ADMIN',     // Trưởng nhóm
  DEPUTY: 'DEPUTY',   // Phó nhóm
  MEMBER: 'MEMBER'    // Thành viên
};

const MEMBER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BANNED: 'BANNED'
};

class GroupMemberService {
  /**
   * Add member to group
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @param {string} role - Member role (ADMIN or MEMBER)
   * @param {string} [addedBy] - User ID của người thêm thành viên (tùy chọn)
   * @returns {Promise<Object>} Group member information
   */
  async addMember(groupId, userId, role = 'MEMBER', addedBy) {
    try {
        console.log('Adding member:', { groupId, userId, role, addedBy });
        const timestamp = new Date().toISOString();

        // First check if member already exists
        const existingMember = await this.getMember(groupId, userId);
        console.log('Existing member:', existingMember);

        if (existingMember) {
            if (existingMember.isActive) {
                console.log('Member already exists and is active');
                return existingMember;
            }

            // If member exists but is inactive, reactivate them
            console.log('Reactivating inactive member');
            const updateParams = {
                TableName: TABLES.GROUP_MEMBERS,
                Key: {
                    groupId,
                    userId
                },
                UpdateExpression: 'set isActive = :isActive, #role = :role, updatedAt = :updatedAt, joinedAt = :joinedAt' + (addedBy ? ', addedBy = :addedBy' : ''),
                ExpressionAttributeNames: {
                    '#role': 'role'
                },
                ExpressionAttributeValues: {
                    ':isActive': true,
                    ':role': role,
                    ':updatedAt': timestamp,
                    ':joinedAt': timestamp
                },
                ReturnValues: 'ALL_NEW'
            };
            if (addedBy) updateParams.ExpressionAttributeValues[':addedBy'] = addedBy;

            const { Attributes } = await dynamodb.send(new UpdateCommand(updateParams));
            console.log('Member reactivated:', Attributes);
            
            // Update group's member count
            await groupService.updateMemberCount(groupId, 1);
            
            return Attributes;
        }

        // Add new member
        const params = {
            TableName: TABLES.GROUP_MEMBERS,
            Item: {
                groupId,
                userId,
                role,
                joinedAt: timestamp,
                updatedAt: timestamp,
                isActive: true,
                lastReadAt: timestamp
            }
        };
        if (addedBy) params.Item.addedBy = addedBy;

        await dynamodb.send(new PutCommand(params));
        console.log('New member added');
        
        // Update group member count
        await groupService.updateMemberCount(groupId, 1);
        
        return params.Item;
    } catch (error) {
        console.error('Error adding member:', error);
        throw error;
    }
  }

  /**
   * Remove member from group
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async removeMember(groupId, userId) {
    try {
        // First check if member exists and is active
        const currentMember = await this.getMember(groupId, userId);
        if (!currentMember || !currentMember.isActive) {
            throw new Error('Member not found or already removed');
        }

        // Set member as inactive instead of deleting
        const params = {
            TableName: TABLES.GROUP_MEMBERS,
            Key: {
                groupId,
                userId
            },
            UpdateExpression: 'set isActive = :isActive, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':isActive': false,
                ':updatedAt': new Date().toISOString()
            }
        };

        await dynamodb.send(new UpdateCommand(params));

        // Update group's member count
        await groupService.updateMemberCount(groupId, -1);
    } catch (error) {
        console.error('Error removing member:', error);
        throw error;
    }
  }

  /**
   * Get group members
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} List of group members
   */
  async getGroupMembers(groupId) {
    try {
        const params = {
            TableName: TABLES.GROUP_MEMBERS,
            KeyConditionExpression: 'groupId = :groupId',
            FilterExpression: 'isActive = :isActive',
            ExpressionAttributeValues: {
                ':groupId': groupId,
                ':isActive': true
            }
        };

        const { Items } = await dynamodb.send(new QueryCommand(params));
        return Items;
    } catch (error) {
        console.error('Error getting group members:', error);
        throw error;
    }
  }

  /**
   * Check if user is member of group
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if user is member
   */
  async isMember(groupId, userId) {
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: {
        groupId,
        userId
      }
    };

    const result = await dynamodb.send(new GetCommand(params));
    return result.Item && result.Item.isActive === true;
  }

  /**
   * Update member role
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @param {string} role - New role
   * @returns {Promise<Object>} Updated member information
   */
  async updateRole(groupId, userId, role) {
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: {
        groupId,
        userId
      },
      UpdateExpression: 'set #role = :role, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': role,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Update last read timestamp
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated member information
   */
  async updateLastRead(groupId, userId) {
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: {
        groupId,
        userId
      },
      UpdateExpression: 'set lastReadAt = :lastReadAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':lastReadAt': new Date().toISOString(),
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Get member by group ID and user ID
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Member information
   */
  async getMember(groupId, userId) {
    try {
        const params = {
            TableName: TABLES.GROUP_MEMBERS,
            Key: {
                groupId,
                userId
            }
        };

        const { Item } = await dynamodb.send(new GetCommand(params));
        return Item;
    } catch (error) {
        console.error('Error getting member:', error);
        throw error;
    }
  }

  /**
   * Update member information
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated member
   */
  async updateMember(groupId, userId, updateData) {
    const timestamp = new Date().toISOString();
    const updateExpressions = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    Object.keys(updateData).forEach(key => {
      if (key !== 'groupId' && key !== 'userId') {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updateData[key];
      }
    });

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;

    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: { groupId, userId },
      UpdateExpression: `set ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Get members by role
   * @param {string} groupId - Group ID
   * @param {string} role - Member role
   * @returns {Promise<Array>} List of members
   */
  async getMembersByRole(groupId, role) {
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      IndexName: 'role-index',
      KeyConditionExpression: 'groupId = :groupId AND role = :role',
      ExpressionAttributeValues: {
        ':groupId': groupId,
        ':role': role
      }
    };

    const result = await dynamodb.send(new QueryCommand(params));
    return result.Items;
  }

  /**
   * Update member's last active timestamp
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated member
   */
  async updateLastActive(groupId, userId) {
    const timestamp = new Date().toISOString();
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: { groupId, userId },
      UpdateExpression: 'set lastActiveAt = :lastActiveAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':lastActiveAt': timestamp,
        ':updatedAt': timestamp
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }
}

module.exports = {
  GroupMemberService: new GroupMemberService(),
  MEMBER_ROLES,
  MEMBER_STATUS
}; 