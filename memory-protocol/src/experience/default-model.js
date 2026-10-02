/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { renderExperienceModelText } from "./model-text.js";

export const DEFAULT_EXPERIENCE_MODEL_TREE = Object.freeze({
  career_wealth: Object.freeze({
    career_development: Object.freeze([
      "career_planning",
      "leadership",
      "skill_development",
      "team_management",
    ]),
    entrepreneurship_business: Object.freeze([
      "business_model",
      "market_analysis",
      "startup_strategy",
    ]),
    financial_planning: Object.freeze([
      "asset_allocation",
      "investment_wealth_management",
      "spending_review",
    ]),
  }),
  creativity_arts: Object.freeze({
    aesthetics_appreciation: Object.freeze([
      "aesthetic_theory",
      "art_appreciation",
      "cultural_experience",
    ]),
    artistic_creation: Object.freeze(["creative_writing", "music_performance", "painting_design"]),
    creative_expression: Object.freeze(["crafts_handwork", "innovation_projects", "photography"]),
  }),
  lifestyle_interests: Object.freeze({
    hobbies_interests: Object.freeze(["gaming", "hobby_skills", "sports_competition"]),
    lifestyle: Object.freeze(["home_organization", "life_rituals", "styling_personal_image"]),
    travel_exploration: Object.freeze([
      "cultural_experience",
      "nature_exploration",
      "travel_planning",
    ]),
  }),
  mindset_cognition: Object.freeze({
    decision_judgment: Object.freeze([
      "long_term_planning",
      "priority_analysis",
      "risk_assessment",
    ]),
    emotion_psychology: Object.freeze(["emotion_regulation", "self_motivation", "stress_relief"]),
    mental_models: Object.freeze(["cognitive_biases", "decision_frameworks", "problem_solving"]),
  }),
  personal_health: Object.freeze({
    energy_management: Object.freeze([
      "efficiency_improvement",
      "recovery_relaxation",
      "time_management",
    ]),
    habits_growth: Object.freeze(["focus_training", "habit_building", "self_discipline_methods"]),
    physical_mental_health: Object.freeze(["diet_sleep", "exercise_training", "mental_wellbeing"]),
  }),
  society_relationships: Object.freeze({
    communication_influence: Object.freeze([
      "cross_cultural_communication",
      "negotiation",
      "public_speaking",
    ]),
    interpersonal_relationships: Object.freeze([
      "family_relationships",
      "friendship_socializing",
      "workplace_relationships",
    ]),
    social_observation: Object.freeze(["history_humanities", "laws_policies", "social_phenomena"]),
  }),
  technology_knowledge: Object.freeze({
    digital_technology: Object.freeze([
      "ai_machine_learning",
      "big_data",
      "blockchain",
      "cloud_computing",
    ]),
    learning_education: Object.freeze([
      "knowledge_management",
      "learning_methods",
      "teaching_training",
    ]),
    rnd_engineering: Object.freeze([
      "architecture_design",
      "code_optimization",
      "testing_deployment",
      "tools_productivity",
    ]),
    scientific_thinking: Object.freeze([
      "data_analysis",
      "experimentation_validation",
      "logical_reasoning",
    ]),
  }),
});

export function renderDefaultExperienceModelText() {
  return renderExperienceModelText(DEFAULT_EXPERIENCE_MODEL_TREE);
}
