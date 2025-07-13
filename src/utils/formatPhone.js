const formatPhone = (phone) => {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If phone starts with 0, remove it
  if (digits.startsWith('0')) {
    return `84${digits.substring(1)}`;
  }
  
  // If phone doesn't start with 84, add it
  if (!digits.startsWith('84')) {
    return `84${digits}`;
  }
  
  return digits;
};

module.exports = formatPhone; 