/**
 * @author mengxin
 * @name IP变化通知
 * @team 小寒寒-萌欣二改
 * @origin 小寒寒-萌欣二改
 * @version 1.2.5
 * @rule ^IP变化通知$
 * @description IP变化通知，变化后执行用户自定义命令，多线路的请勿使用
 * @admin true
 * @public true
 * @priority 1000
 * @cron 0 *\/3 * * * *
 * @classification ["工具"]
 说明：
 1、在红灯区同级目录创建一个文件夹，名字随意 如：mengxin
       IP变化通知.js 放到mengxin文件夹中
 注意：
   1、自用插件
   2、简单测试可用 
   3.试手插件，小白一枚，AI指导，瞎几把写的  
 ----------------------
 功能：
   1、自定义添加IPv4检测接口，可多个
   2.自定义通知平台
   3.自定义ip变化后执行自定义命令
   ----------------------
 更新日志：
   2025.7.29 v1.2.5 插件上线
   插件由寒寒大佬的插件以及九九佬的插件结合AI修改而成，感谢D佬指导
   由于需要更换代理白名单才写的这个插件，我是需要更换携趣的白名单结合VICTOR_LI佬的携趣多账号切换白名单.js使用
   当检测到ip变化后自动执行xq指令更换白名单，其他指令没测试过，请自行测试。  
 */

const log4js = require("log4js");
const log = log4js.getLogger("ipChange.js");
log.level = "info";
const got = require("got");

// 配置模式定义
const jsonSchema = BncrCreateSchema.object({
    enable: BncrCreateSchema.boolean()
        .setTitle('启用插件')
        .setDescription('是否开启IP变化检测功能')
        .setDefault(true),
    ipv4Apis: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle('IPv4检测接口列表')
        .setDescription('用于获取公网IPv4的API地址，按顺序尝试（确保为IPv4接口）')
        .setDefault([
            "https://4.ipw.cn/", 
            "https://ip.3322.net/", 
            "https://apis.jxcxin.cn/api/bjip"
        ]),
    // 推送位置配置，平台字段改为自由填写
    pushLocations: BncrCreateSchema.array(
        BncrCreateSchema.object({
            platform: BncrCreateSchema.string()
                .setTitle('平台')
                .setDescription('填写消息推送的平台适配器名称')
                .setDefault('tgBot'),
            userId: BncrCreateSchema.string()
                .setTitle('用户ID')
                .setDescription('接收消息的用户ID（与群组ID二选一）')
                .setDefault(''),
            groupId: BncrCreateSchema.string()
                .setTitle('群组ID')
                .setDescription('接收消息的群组ID（与用户ID二选一）')
                .setDefault('')
        })
    )
    .setTitle('推送目标')
    .setDescription('配置IP变化消息的推送位置，支持多平台多目标')
    .setDefault([{ platform: 'tgBot', userId: '123456789' }]),
    changeCommands: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle('IP变化执行命令')
        .setDescription('IP变更后需要执行的命令列表，支持多条命令按顺序执行')
        .setDefault(['更换白名单']),
    errorNotify: BncrCreateSchema.boolean()
        .setTitle('启用错误通知')
        .setDescription('当IP获取失败时是否通知管理员')
        .setDefault(true)
});

// 初始化配置
const ConfigDB = new BncrPluginConfig(jsonSchema);

// 验证推送位置配置有效性
function validatePushLocation(loc) {
    if (!loc.platform) {
        log.error(`推送配置错误：平台不能为空`);
        return false;
    }
    if (loc.userId && loc.groupId) {
        log.error(`推送配置错误：用户ID和群组ID不能同时填写 (平台: ${loc.platform})`);
        return false;
    }
    if (!loc.userId && !loc.groupId) {
        log.error(`推送配置错误：用户ID和群组ID必须填写一个 (平台: ${loc.platform})`);
        return false;
    }
    return true;
}

module.exports = async (s) => {
    await ConfigDB.get();
    if (!ConfigDB.userConfig.enable) return;

    const djunDB = new BncrDB("djunDB");
    let oldIp = await djunDB.get("local_ip");
    let newIp = null;

    // 获取当前IPv4
    for (const url of ConfigDB.userConfig.ipv4Apis) {
        try {
            const response = await got.get(url, { timeout: 10000 });
            const ipPattern = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
            const match = response.body.match(ipPattern);
            if (match && match.length > 0) {
                newIp = match[0].trim();
                log.info(`从接口 ${url} 成功获取IPv4: ${newIp}`);
                break;
            }
        } catch (error) {
            log.error(`接口 ${url} 访问失败: ${error.message}`);
        }
    }

    // 处理IP获取失败场景
    if (!newIp) {
        log.error("所有IP检测接口均失败");
        if (ConfigDB.userConfig.errorNotify) {
            // 遍历推送位置，发送错误通知
            for (const loc of ConfigDB.userConfig.pushLocations) {
                if (!validatePushLocation(loc)) continue;
                
                try {
                    await sysMethod.push({
                        platform: [loc.platform],
                        type: 'text',
                        msg: "【IP检测错误】\n所有配置的IP获取接口均无法访问，请检查接口可用性",
                        userId: loc.userId,
                        groupId: loc.groupId
                    });
                } catch (error) {
                    log.error(`向 ${loc.platform} 推送错误通知失败: ${error.message}`);
                }
            }
        }
        return;
    }

    // 验证IP格式（确保是IPv4）
    if (newIp.split(".").length !== 4) {
        log.error(`获取到无效IPv4格式: ${newIp}`);
        return;
    }

    // 首次记录IP
    if (!oldIp) {
        await djunDB.set("local_ip", newIp);
        log.info(`首次运行，记录初始IPv4: ${newIp}`);
        return;
    }

    // IP未变化
    if (newIp === oldIp) {
        log.info(`IPv4未变化: ${newIp}`);
        return;
    }

    // IP发生变化
    log.info(`IPv4发生变更: ${oldIp} -> ${newIp}`);
    await djunDB.set("local_ip", newIp);

    // 发送变更通知到各个推送位置
    const notifyMsg = `【IP变更通知】\n上次IP：${oldIp}\n当前IP：${newIp}\n即将执行以下命令：\n${ConfigDB.userConfig.changeCommands.join('\n')}`;
    for (const loc of ConfigDB.userConfig.pushLocations) {
        if (!validatePushLocation(loc)) continue;
        
        try {
            await sysMethod.push({
                platform: [loc.platform],
                type: 'text',
                msg: notifyMsg,
                userId: loc.userId,
                groupId: loc.groupId
            });
            log.info(`已向 ${loc.platform}（${loc.userId || loc.groupId}）推送通知`);
        } catch (error) {
            log.error(`向 ${loc.platform}（${loc.userId || loc.groupId}）推送通知失败: ${error.message}`);
        }
    }

    // 执行自定义命令列表
    for (const cmd of ConfigDB.userConfig.changeCommands) {
        try {
            log.info(`执行命令: ${cmd}`);
            await sysMethod.inline(cmd);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 命令间延迟1秒，避免冲突
        } catch (error) {
            log.error(`命令 ${cmd} 执行失败: ${error.message}`);
            // 遍历推送位置，发送命令执行失败通知
            for (const loc of ConfigDB.userConfig.pushLocations) {
                if (!validatePushLocation(loc)) continue;
                
                try {
                    await sysMethod.push({
                        platform: [loc.platform],
                        type: 'text',
                        msg: `【命令执行失败】\n命令: ${cmd}\n错误: ${error.message}`,
                        userId: loc.userId,
                        groupId: loc.groupId
                    });
                } catch (error) {
                    log.error(`向 ${loc.platform} 推送命令失败通知失败: ${error.message}`);
                }
            }
        }
    }

    log.info("IP变更处理流程完成");
};
