package com.deepstudy.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("DeepStudy API")
                        .version("1.0.0")
                        .description("专注力管理桌面应用后端 API")
                        .contact(new Contact().name("DeepStudy"))
                        .license(new License().name("AGPL-3.0")));
    }
}
