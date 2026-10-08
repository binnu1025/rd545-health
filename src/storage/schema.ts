/** Column headers of the 人員 and 量測紀錄 tabs, shared by the writer, the reader and the old-sheet import. */
export const peopleHeaders = ['id', '群組', '姓名', '性別', '出生日期', '身高cm', '體脂計本人', '建立時間'] as const;
export const recordHeaders = ['紀錄鍵', '量測時間', '人員id', '群組', '姓名', '體重kg', 'BMI', '體脂率%', '肌肉量kg', '肌肉評分', '骨量kg',
  '體水分率%', '內臟脂肪', '基礎代謝kcal', '代謝年齡', '肌肉品質', '身高cm',
  '右手肌肉kg', '右手體脂%', '右手肌肉評分', '右手肌肉品質', '左手肌肉kg', '左手體脂%', '左手肌肉評分', '左手肌肉品質',
  '軀幹肌肉kg', '軀幹體脂%', '軀幹肌肉評分', '右腳肌肉kg', '右腳體脂%', '右腳肌肉評分', '右腳肌肉品質',
  '左腳肌肉kg', '左腳體脂%', '左腳肌肉評分', '左腳肌肉品質', '寫入時間'] as const;
