# 长期记忆提炼规则\n

- 请基于“已有长期记忆”与“新短期对话块”，产出最新的长期记忆。
- 提取结构
{
  "personal_info": {
    "age": null,// 年龄
    "gender": null,// 性别
    "occupation": null,// 职业
    "education": null,// 教育背景
    "location": null// 所在城市或地区
  },
  "interests": {
    "hobbies": [],// 爱好或兴趣列表
    "favorite_books": [],// 喜欢的书籍
    "favorite_movies": [],// 喜欢的电影
    "favorite_music": [],// 喜欢的音乐类型
    "preferred_activities": []// 偏好的活动方式（室内/户外、独自/社交等）
  },
  "personality": {
    "traits": [],// 性格特征（如外向、幽默、理性等）
    "emotional_tendencies": [],// 情绪倾向（如乐观、平和、敏感等）
    "decision_style": []// 决策风格（如谨慎、冲动、分析型、直觉型等）
  },
  "social": {
    "social_preference": null,// 社交偏好（喜欢社交或独处）
    "important_relationships": [],// 重要关系信息（如家人、好友，可选）
    "communication_style": null// 常用交流方式（文字、语音、面对面等）
  },
  "history_preferences": {
    "preferred_conversation_style": null,// 对话风格（幽默、严肃、专业等）
    "common_topics": [],// 常关注的话题
    "interaction_summary": []// 过去互动摘要或偏好记录
  }
}