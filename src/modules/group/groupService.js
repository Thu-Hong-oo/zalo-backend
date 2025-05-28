const { TABLES } = require('../../config/aws');
const { v4: uuidv4 } = require('uuid');
const userController = require('../user/controller');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { 
    DynamoDBDocumentClient, 
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    ScanCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

class GroupService {
  /**
   * Create a new chat group
   * @param {Object} groupData - Group information
   * @returns {Promise<Object>} Created group
   */
  async createGroup(groupData) {
    try {
        console.log('Creating group with data:', groupData);
        const timestamp = new Date().toISOString();
        const groupId = uuidv4();

        // If name is provided, use it directly
        if (groupData.name) {
            console.log('Using provided group name:', groupData.name);
        } else {
            // Get user details for all members to generate group name
            console.log('Generating group name from member names');
            const memberNames = [];
            for (const memberId of groupData.members) {
                try {
                    const userData = await userController.getUserByUserId(memberId);
                    if (userData && userData.name) {
                        memberNames.push(userData.name);
                    }
                } catch (error) {
                    console.error('Error getting user data for member:', memberId, error);
                }
            }
            
            // Generate group name from all member names
            if (memberNames.length > 0) {
                groupData.name = memberNames.join(', ');
            } else {
                groupData.name = 'New Group';
            }
            console.log('Generated group name:', groupData.name);
        }

        // Create group record
        const params = {
            TableName: TABLES.GROUPS,
            Item: {
                groupId,
                name: groupData.name,
                description: groupData.description || '',
                createdBy: groupData.createdBy,
                createdAt: timestamp,
                updatedAt: timestamp,
                lastMessageAt: timestamp,
                memberCount: groupData.members.length,
                isActive: true,
                lastMessage: null
            }
        };

        console.log('Creating group with params:', params);
        await dynamodb.send(new PutCommand(params));

        // Add all members to the group
        const memberPromises2 = groupData.members.map(userId => {
            const role = userId === groupData.createdBy ? 'ADMIN' : 'MEMBER';
            return this.addMember(groupId, userId, role);
        });

        await Promise.all(memberPromises2);
        console.log('All members added to group');

        // Get updated group info with correct member count
        const createdGroup = await this.getGroupById(groupId);
        console.log('Final group data:', createdGroup);
        return createdGroup;
    } catch (error) {
        console.error('Error creating group:', error);
        throw error;
    }
  }

  /**
   * Get group by ID
   * @param {string} groupId - Group ID
   * @returns {Promise<Object>} Group information
   */
  async getGroupById(groupId) {
    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId }
    };

    const { Item: group } = await dynamodb.send(new GetCommand(params));
    if (!group) return null;

    // Get all members information
    const membersResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.GROUP_MEMBERS,
      KeyConditionExpression: 'groupId = :groupId',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':groupId': groupId,
        ':isActive': true
      }
    }));

    // Get user details for each member
    const memberPromises = membersResult.Items.map(async (member) => {
      try {
        const userData = await userController.getUserByUserId(
          { params: { userId: member.userId } }
        );

        if (!userData) {
          return {
            userId: member.userId,
            name: 'Unknown User',
            avatar: null,
            role: member.role,
            joinedAt: member.joinedAt,
            lastReadAt: member.lastReadAt
          };
        }
        
        // Combine member info with user details
        return {
          userId: member.userId,
          name: userData.name,
          avatar: userData.avatar,
          phone: userData.phone,
          role: member.role,
          joinedAt: member.joinedAt,
          lastReadAt: member.lastReadAt
        };
      } catch (error) {
        console.error('Error getting user data:', error);
        return {
          userId: member.userId,
          name: 'Unknown User',
          avatar: null,
          role: member.role,
          joinedAt: member.joinedAt,
          lastReadAt: member.lastReadAt
        };
      }
    });

    const membersWithDetails = await Promise.all(memberPromises);

    // Add members info to group
    group.members = membersWithDetails;

    return group;
  }

  /**
   * Update group information
   * @param {string} groupId - Group ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated group
   */
  async updateGroup(groupId, updateData) {
    const timestamp = new Date().toISOString();
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    let updateExpression = 'set ';

    // Process each field in updateData
    Object.entries(updateData).forEach(([key, value]) => {
      if (key !== 'groupId' && key !== 'createdAt' && key !== 'members') {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    });

    // Add updatedAt
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;

    updateExpression += updateExpressions.join(', ');

    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Add member to group
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID to add
   * @param {string} role - Member role (ADMIN or MEMBER)
   * @returns {Promise<Object>} Updated group member
   */
  async addMember(groupId, userId, role = 'MEMBER') {
    // Ensure groupId and userId are strings
    if (typeof groupId !== 'string') {
      throw new Error('groupId must be a string');
    }
    if (typeof userId !== 'string') {
      throw new Error('userId must be a string');
    }

    const timestamp = new Date().toISOString();

    // Check if member already exists
    const params = {
      TableName: TABLES.GROUP_MEMBERS,
      Key: {
        groupId: groupId.toString(),
        userId: userId.toString()
      }
    };

    const { Item: existingMember } = await dynamodb.send(new GetCommand(params));

    // If member exists and is active, don't add again
    if (existingMember && existingMember.isActive) {
      return existingMember;
    }

    // If member exists but inactive, reactivate them
    if (existingMember) {
      const updateParams = {
        TableName: TABLES.GROUP_MEMBERS,
        Key: {
          groupId: groupId.toString(),
          userId: userId.toString()
        },
        UpdateExpression: 'set isActive = :isActive, updatedAt = :updatedAt, role = :role',
        ExpressionAttributeValues: {
          ':isActive': true,
          ':updatedAt': timestamp,
          ':role': role
        },
        ReturnValues: 'ALL_NEW'
      };

      const { Attributes } = await dynamodb.send(new UpdateCommand(updateParams));
      return Attributes;
    }

    // Add new member
    const newMemberParams = {
      TableName: TABLES.GROUP_MEMBERS,
      Item: {
        groupId: groupId.toString(),
        userId: userId.toString(),
        role,
        joinedAt: timestamp,
        updatedAt: timestamp,
        isActive: true,
        lastReadAt: timestamp
      }
    };

    await dynamodb.send(new PutCommand(newMemberParams));
    return newMemberParams.Item;
  }

  /**
   * Remove member from group
   * @param {string} groupId - Group ID
   * @param {string} userId - User ID to remove
   * @returns {Promise<Object>} Updated group
   */
  async removeMember(groupId, userId) {
    // First get the current group to find the index of the user
    const group = await this.getGroupById(groupId);
    const memberIndex = group.members.indexOf(userId);
    
    if (memberIndex === -1) {
      throw new Error('User is not a member of this group');
    }

    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId },
      UpdateExpression: `REMOVE members[${memberIndex}] SET updatedAt = :updatedAt`,
      ExpressionAttributeValues: {
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * List all groups where user is a member
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of groups
   */
  async getUserGroups(userId) {
    try {
      console.log('Getting groups for user:', userId);
      
      // Get all group memberships for the user
      const membershipParams = {
        TableName: TABLES.GROUP_MEMBERS,
        FilterExpression: 'userId = :userId AND isActive = :isActive',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':isActive': true
        }
      };

      const memberships = await dynamodb.send(new ScanCommand(membershipParams));
      console.log('Found memberships:', memberships.Items?.length || 0);
      
      if (!memberships.Items || memberships.Items.length === 0) {
        console.log('No groups found for user:', userId);
        return [];
      }

      // Get details for each group
      const groupPromises = memberships.Items.map(async (membership) => {
        try {
          const group = await this.getGroupById(membership.groupId);
          if (group && group.isActive) {
            return {
              ...group,
              memberRole: membership.role,
              lastReadAt: membership.lastReadAt
            };
          }
          return null;
        } catch (error) {
          console.error('Error getting group details:', error);
          return null;
        }
      });

      const groups = await Promise.all(groupPromises);

      // Filter out null values and sort by lastMessageAt
      return groups
        .filter(group => group !== null)
        .sort((a, b) => {
          const timeA = new Date(a.lastMessageAt || a.createdAt);
          const timeB = new Date(b.lastMessageAt || b.createdAt);
          return timeB - timeA;
        });
    } catch (error) {
      console.error('Error in getUserGroups:', error);
      throw error;
    }
  }

  /**
   * Delete group (hard delete)
   * @param {string} groupId - Group ID
   * @returns {Promise<void>}
   */
  async deleteGroup(groupId) {
    try {
        console.log('Deleting group:', groupId);

        // 1. Get all members from GROUP_MEMBERS table
        const membersResult = await dynamodb.send(new QueryCommand({
            TableName: TABLES.GROUP_MEMBERS,
            KeyConditionExpression: 'groupId = :groupId',
            ExpressionAttributeValues: {
                ':groupId': groupId
            }
        }));

        console.log('Found members:', membersResult.Items);

        // 2. Delete each member entry
        const memberDeletions = membersResult.Items.map(member => {
            return dynamodb.send(new DeleteCommand({
                TableName: TABLES.GROUP_MEMBERS,
                Key: {
                    groupId: member.groupId,
                    userId: member.userId
                }
            }));
        });

        // Wait for all member deletions to complete
        await Promise.all(memberDeletions);
        console.log('All members deleted');

        // 3. Delete the group from GROUPS table
        await dynamodb.send(new DeleteCommand({
            TableName: TABLES.GROUPS,
            Key: { groupId }
        }));

        console.log('Group deleted successfully');
    } catch (error) {
        console.error('Error deleting group:', error);
        throw error;
    }
  }

  /**
   * Update last message in group
   * @param {string} groupId - Group ID
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Updated group
   */
  async updateLastMessage(groupId, messageData) {
    const timestamp = new Date().toISOString();

    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId },
      UpdateExpression: 'set lastMessage = :lastMessage, lastMessageAt = :lastMessageAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':lastMessage': messageData,
        ':lastMessageAt': timestamp,
        ':updatedAt': timestamp
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Update member count
   * @param {string} groupId - Group ID
   * @param {number} change - Change in member count (+1 or -1)
   * @returns {Promise<Object>} Updated group
   */
  async updateMemberCount(groupId, change) {
    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId },
      UpdateExpression: 'set memberCount = memberCount + :change, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':change': change,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Sync member count for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<Object>} Updated group
   */
  async syncMemberCount(groupId) {
    // Get active members count
    const membersResult = await dynamodb.send(new QueryCommand({
      TableName: TABLES.GROUP_MEMBERS,
      KeyConditionExpression: 'groupId = :groupId',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':groupId': groupId,
        ':isActive': true
      }
    }));

    const actualCount = membersResult.Items.length;

    // Update group with correct count
    const params = {
      TableName: TABLES.GROUPS,
      Key: { groupId },
      UpdateExpression: 'set memberCount = :count, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':count': actualCount,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.send(new UpdateCommand(params));
    return result.Attributes;
  }

  /**
   * Update group avatar
   * @param {string} groupId - Group ID
   * @param {string} avatarUrl - URL of uploaded avatar
   * @returns {Promise<Object>} Updated group
   */
  async updateGroupAvatar(groupId, avatarUrl) {
    try {
      const timestamp = new Date().toISOString();
      
      const params = {
        TableName: TABLES.GROUPS,
        Key: { groupId },
        UpdateExpression: 'set avatar = :avatar, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':avatar': avatarUrl,
          ':updatedAt': timestamp
        },
        ReturnValues: 'ALL_NEW'
      };

      const result = await dynamodb.send(new UpdateCommand(params));
      return result.Attributes;
    } catch (error) {
      console.error('Error updating group avatar:', error);
      throw error;
    }
  }
}

module.exports = new GroupService(); 