NOOBOT_LONG_MEMORY_MODEL/1

# 每行：字段 | 类型 | 说明

# single：单值，更新时整体覆盖旧值

# list:N：数组，按序号增删改，最多 N 项，满了必须先合并或删除再新增

personal_info.age | single | 年龄
personal_info.gender | single | 性别
personal_info.occupation | single | 职业
personal_info.education | single | 教育背景
personal_info.location | single | 城市或地区

interests.hobbies | list:5 | 兴趣爱好
interests.favorite_books | list:5 | 喜欢的书籍
interests.favorite_movies | list:5 | 喜欢的电影
interests.favorite_music | list:3 | 喜欢的音乐类型
interests.preferred_activities | list:3 | 偏好的活动方式

personality.traits | list:5 | 性格特征
personality.emotional_tendencies | list:3 | 情绪倾向
personality.decision_style | single | 决策风格

social.social_preference | single | 社交偏好
social.important_relationships | list:5 | 重要关系信息
social.communication_style | single | 沟通方式

history_preferences.preferred_conversation_style | single | 偏好的对话风格
history_preferences.common_topics | list:8 | 常关注的话题
