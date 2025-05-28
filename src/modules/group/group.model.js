/**
 * @typedef {Object} Group
 * @property {string} groupId - Unique identifier for the group
 * @property {string} name - Name of the group
 * @property {string} description - Description of the group
 * @property {string} createdBy - User ID of group creator
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {Array<string>} members - Array of member user IDs
 * @property {boolean} isActive - Whether the group is active
 */

/**
 * @typedef {Object} GroupMember
 * @property {string} groupId - ID of the group
 * @property {string} userId - ID of the member
 * @property {string} role - Member role (ADMIN, MODERATOR, MEMBER)
 * @property {string} joinedAt - ISO timestamp when member joined
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {string} addedBy - User ID of who added this member
 * @property {boolean} isActive - Whether the member is active
 * @property {string} nickname - Member's nickname in the group
 * @property {string} lastReadTimestamp - ISO timestamp of last message read
 */

