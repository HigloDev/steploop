import React from 'react'
import { Alert, Linking, View } from 'react-native'
import { RootStackScreen } from '../navigation/types'
import { Button } from '../components/ui'
import { CoachMessage, CoachPage, CoachSection, CoachText, useCoachData } from '../components/coach-ui'
import { activeEnrollment, courseById } from '../core/coach'

export default function CoachCourse({ navigation, route }: RootStackScreen<'CoachCourse'>) {
  const course = courseById(route.params.courseId), data = useCoachData(navigation)
  const current = data.state ? activeEnrollment(data.state) : undefined
  const enroll = () => {
    const open = () => navigation.navigate('CoachGoal', { courseId: course.id })
    if (current) Alert.alert('开始新的阶段？', '保存新计划后，当前的' + courseById(current.courseId).name + '会暂停，历史记录会保留。', [
      { text: '取消', style: 'cancel' }, { text: '设置新计划', onPress: open },
    ]); else open()
  }
  return <CoachPage title={course.name}>
    <CoachText size="value">{course.description}</CoachText>
    <CoachText tone="accent">{course.duration} · {course.outcome}</CoachText>
    <CoachMessage error={data.error} loading={data.loading} retry={() => void data.refresh()} />
    <CoachSection title="课程会陪你做什么">
      {course.lessons.map((lesson, i) => <CoachText key={lesson}>{i + 1}. {lesson}</CoachText>)}
    </CoachSection>
    <CoachSection title="每次训练怎样进行">
      <CoachText>平地热身 5 分钟 → 分段上爬 → 返回与充分恢复 → 结束后慢走缓和。</CoachText>
      <CoachText tone="muted">起步只安排少量净上爬时间，热身、返回和休息另计。可以提前结束，已经完成的运动仍会留下记录。</CoachText>
    </CoachSection>
    <CoachSection title="适合自己，才容易坚持">
      <CoachText tone="muted">面向能独立上下楼的成年人。关节疼痛、胸闷、头晕、异常气短，或有需要专业指导的疾病时，请先咨询专业人员；未成年人、孕产期人群需采用适合自己的方案。</CoachText>
      <CoachText tone="muted">{course.id === 'cardio' ? '研究中的强度与参与者有限，本课程采用较温和的渐进安排，不能据此承诺心肺指标的改善。' : course.id === 'weight' ? '体重管理结合饮食、运动和生活习惯；目标日期用于复盘，不承诺到期减重。达到目标后可进入维持阶段。' : '先选短、平缓、明亮且有扶手的楼梯。一步一级，不跨级、不负重，不追求速度。'}</CoachText>
    </CoachSection>
    <CoachSection title="课程依据">
      <CoachText size="small" tone="muted">{course.source}。课程名称、周期和界面安排为循阶设计。</CoachText>
      <Button title="阅读原始资料" variant="secondary" onPress={() => void Linking.openURL(course.url).catch(() => data.setError('资料链接暂时无法打开，请稍后重试。'))} />
    </CoachSection>
    <View style={{ gap: 12 }}>
      {current?.courseId === course.id ? <Button title="回到正在进行的课程" onPress={() => navigation.navigate('Main', { screen: 'Coach' })} /> :
        <Button title={course.id === 'weight' ? '设定目标，开始体重管理' : '安排我的第一周'} disabled={!data.state || !!data.error} onPress={enroll} />}
    </View>
  </CoachPage>
}
